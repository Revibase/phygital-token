import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	appendTransactionMessageInstructions,
	blockhash,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	generateKeyPairSigner,
	getTransactionEncoder,
	isSignerRole,
	isWritableRole,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Instruction,
	type V1TransactionConfig
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	findAssociatedTokenPda,
	getCreateAssociatedTokenIdempotentInstruction,
	TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token';
import {
	assembleSignedExecuteTx,
	bytesToBase64Url,
	buildSignMessageChallenge,
	decodeTransaction,
	EXECUTE_CLEAR_SIGN_VERSION,
	findVaultPda,
	findWalletPda,
	framePasskeyMessageProof,
	splitTopLevelInstructions,
	walletSeed,
	type ExecuteClearSignInput
} from 'revibase-wallet-sdk';

import { issueOwnerLoginChallenge, verifyOwnerLogin } from '#lib/server/accessory/owner-browse.ts';
import {
	breaksEven,
	inspectRelayedTransaction,
	MAX_RELAYED_PRIORITY_FEE_LAMPORTS,
	type RelayContext
} from '#lib/server/fee-payer/policy.ts';
import { base64UrlToBytes } from '#lib/shared/encoding.ts';
import { LINK_TX_CONFIG } from '#lib/shared/fee-policy.ts';
import { buildLinkTransactionFromTap } from '#lib/shared/link-transaction.ts';
import { decodeMessage } from '#lib/shared/passkey-transaction.ts';
import { messageFeeLamports } from '#lib/shared/wallet-fee.ts';
import { MIGRATIONS, createTestD1 } from './support/d1-sqlite';
import { fakeAccessory, fakeTap } from './support/fixtures';

const BLOCKHASH = {
	blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
	lastValidBlockHeight: 100n
};
const SIGNER_RP_ID = 'signer.revibase.test';
const SIGNER_RP_HASH = sha256(new TextEncoder().encode(SIGNER_RP_ID));
const RENT = 1_948_800n;

/** A passkey wallet as the program derives it: the address follows from the key and RP. */
async function passkeyWallet(rpIdHash: Uint8Array = SIGNER_RP_HASH) {
	const secret = p256.utils.randomSecretKey();
	const publicKey = p256.getPublicKey(secret, true);
	const userSeed = await walletSeed(publicKey, rpIdHash);
	const [wallet] = await findWalletPda({ userSeed });
	const [vault] = await findVaultPda({ wallet });
	const feePayer = (await generateKeyPairSigner()).address;
	return { secret, publicKey, userSeed, rpIdHash, wallet, vault, feePayer };
}
type PasskeyWallet = Awaited<ReturnType<typeof passkeyWallet>>;

/** What the secure signer does: wrap every call the vault makes (only the vault signs inside). */
function wrap(vault: Address, calls: readonly Instruction[]): ExecuteClearSignInput {
	const table: string[] = [vault];
	const index = (a: string) => (table.includes(a) ? table.indexOf(a) : table.push(a) - 1);
	const intents = calls.map((ix) => ({
		programIdIndex: index(ix.programAddress),
		accounts: (ix.accounts ?? []).map((m) => ({
			index: index(m.address),
			isWritable: isWritableRole(m.role),
			isSigner: isSignerRole(m.role) && m.address === vault
		})),
		data: bytesToBase64Url(new Uint8Array(ix.data ?? []))
	}));
	return {
		version: EXECUTE_CLEAR_SIGN_VERSION,
		vault,
		accounts: table.map((a) => ({ address: a })),
		intents
	};
}

const repay = (w: PasskeyWallet, amount: bigint) =>
	getTransferSolInstruction({
		source: createNoopSigner(w.vault),
		destination: w.feePayer,
		amount
	});

/**
 * What the passkey adapter sends the fee payer for `calls`: the calls plus the
 * repayment, wrapped into `execute`, with `create_wallet` first when asked.
 * `payment` defaults to exactly the fee (plus `RENT` when creating).
 */
async function relayed(
	w: PasskeyWallet,
	calls: Instruction[],
	opts: {
		create?: boolean;
		payments?: bigint[] | null;
		config?: V1TransactionConfig;
		createFor?: PasskeyWallet;
	} = {}
) {
	const config = opts.config ?? LINK_TX_CONFIG;
	const { precompiles, wrapped } = splitTopLevelInstructions(calls);
	const assemble = async (payments: bigint[]) => {
		const key = fakeAccessory();
		const assertion = key.assert(new Uint8Array(32)).response;
		const creator = opts.createFor ?? w;
		return assembleSignedExecuteTx({
			feePayer: w.feePayer,
			latestBlockhash: BLOCKHASH,
			wallet: w.wallet,
			vault: w.vault,
			slotNumber: 99,
			execute: wrap(w.vault, [...wrapped, ...payments.map((p) => repay(w, p))]),
			authenticatorData: base64UrlToBytes(assertion.authenticatorData),
			clientDataJSON: base64UrlToBytes(assertion.clientDataJSON),
			signature: base64UrlToBytes(assertion.signature),
			publicKey: w.publicKey,
			config,
			precompiles,
			...(opts.create
				? {
						createWallet: {
							userSeed: creator.userSeed,
							rpIdHash: creator.rpIdHash,
							credentialId: new Uint8Array(16).fill(3),
							publicKey: creator.publicKey
						}
					}
				: {})
		});
	};
	if (opts.payments !== undefined) return assemble(opts.payments ?? []);
	// The fee doesn't depend on the payment, so measure it once and pay it back exactly.
	const fee = messageFeeLamports(decodeMessage(await assemble([0n])));
	return assemble([fee + (opts.create ? RENT : 0n)]);
}

const ctx = (w: { feePayer: Address }): RelayContext => ({
	feePayer: w.feePayer,
	signerRpIdHash: SIGNER_RP_HASH
});

async function sendSol(w: PasskeyWallet) {
	return getTransferSolInstruction({
		source: createNoopSigner(w.vault),
		destination: (await generateKeyPairSigner()).address,
		amount: 1_000_000n
	});
}

describe('Revibase fee payer relay', () => {
	it('relays a vault transaction that pays its fee back', async () => {
		const w = await passkeyWallet();
		const wire = await relayed(w, [await sendSol(w)]);
		const decision = await inspectRelayedTransaction(wire, ctx(w));
		expect(decision).toMatchObject({ ok: true, createdWallet: null });
		if (!decision.ok) return;
		expect(decision.payment).toBe(decision.fee);
		// Fee payer + the wallet's secp256r1 check, plus the 3,000-lamport priority fee.
		expect(decision.fee).toBe(13_000n);
	});

	it('relays a wallet’s first transaction: create_wallet, paid back with its rent', async () => {
		const w = await passkeyWallet();
		const decision = await inspectRelayedTransaction(
			await relayed(w, [await sendSol(w)], { create: true }),
			ctx(w)
		);
		expect(decision).toMatchObject({ ok: true, createdWallet: w.wallet });
		if (decision.ok) expect(decision.payment).toBe(decision.fee + RENT);
	});

	it('relays a passkey claim: the tap’s check stays top-level and is part of the fee', async () => {
		const w = await passkeyWallet();
		const { tap } = await fakeTap();
		tap.session.recipient = w.vault;
		const { wireBytes } = await buildLinkTransactionFromTap({
			tap,
			recipient: createNoopSigner(w.vault),
			feePayer: w.feePayer,
			blockhash: BLOCKHASH
		});
		const calls = [...decodeTransaction(wireBytes).message.instructions];
		const decision = await inspectRelayedTransaction(
			await relayed(w, calls, { create: true }),
			ctx(w)
		);
		expect(decision).toMatchObject({ ok: true, createdWallet: w.wallet });
		// Fee payer + wallet check + tap check: 3 × 5,000 + 3,000.
		if (decision.ok) expect(decision.fee).toBe(18_000n);
	});

	it('refuses a transaction that doesn’t pay the fee payer back exactly once', async () => {
		const w = await passkeyWallet();
		const send = await sendSol(w);
		expect(
			await inspectRelayedTransaction(await relayed(w, [send], { payments: [] }), ctx(w))
		).toEqual({
			ok: false,
			reason: 'the fee payer must be paid back'
		});
		expect(
			await inspectRelayedTransaction(await relayed(w, [send], { payments: [1n, 13_000n] }), ctx(w))
		).toEqual({ ok: false, reason: 'the fee payer must be paid back once' });
	});

	it('refuses the fee payer anywhere but the repayment', async () => {
		const w = await passkeyWallet();
		const mint = (await generateKeyPairSigner()).address;
		const [ata] = await findAssociatedTokenPda({
			owner: w.feePayer,
			mint,
			tokenProgram: TOKEN_PROGRAM_ADDRESS
		});
		const openForFeePayer = getCreateAssociatedTokenIdempotentInstruction({
			payer: createNoopSigner(w.vault),
			ata,
			owner: w.feePayer,
			mint
		});
		expect(await inspectRelayedTransaction(await relayed(w, [openForFeePayer]), ctx(w))).toEqual({
			ok: false,
			reason: 'fee payer used as an account'
		});
	});

	it('refuses create_wallet for another wallet or another RP', async () => {
		const w = await passkeyWallet();
		const other = await passkeyWallet();
		const send = await sendSol(w);
		expect(
			await inspectRelayedTransaction(
				await relayed(w, [send], { create: true, createFor: other }),
				ctx(w)
			)
		).toEqual({ ok: false, reason: 'create_wallet is for another wallet' });
		const elsewhere = await passkeyWallet(new Uint8Array(32).fill(7));
		elsewhere.feePayer = w.feePayer;
		expect(
			await inspectRelayedTransaction(
				await relayed(elsewhere, [await sendSol(elsewhere)], { create: true }),
				ctx(w)
			)
		).toEqual({ ok: false, reason: 'passkey is for a different signer' });
	});

	it('refuses v0, compute-budget instructions and an excessive priority fee', async () => {
		const w = await passkeyWallet();
		const send = await sendSol(w);
		const signed = decodeTransaction(await relayed(w, [send])).message;
		const recompile = (m: object) =>
			new Uint8Array(getTransactionEncoder().encode(compileTransaction({ ...signed, ...m })));
		expect(await inspectRelayedTransaction(recompile({ version: 0 }), ctx(w))).toEqual({
			ok: false,
			reason: 'only version 1 transactions are relayed'
		});
		const budgetIx = getSetComputeUnitLimitInstruction({ units: 1 });
		expect(
			await inspectRelayedTransaction(
				recompile({ instructions: [budgetIx, ...signed.instructions] }),
				ctx(w)
			)
		).toEqual({ ok: false, reason: 'unexpected compute budget instruction' });
		const pricey = await relayed(w, [send], {
			config: { ...LINK_TX_CONFIG, priorityFeeLamports: MAX_RELAYED_PRIORITY_FEE_LAMPORTS + 1n }
		});
		expect(await inspectRelayedTransaction(pricey, ctx(w))).toEqual({
			ok: false,
			reason: 'priority fee too high'
		});
	});

	it('refuses a plain transaction the vault isn’t behind', async () => {
		const w = await passkeyWallet();
		const drain = pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayer(w.feePayer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
			(m) => setTransactionMessageConfig(LINK_TX_CONFIG, m),
			(m) =>
				appendTransactionMessageInstructions(
					[
						getTransferSolInstruction({
							source: createNoopSigner(w.feePayer),
							destination: w.vault,
							amount: 1n
						})
					],
					m
				)
		);
		const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(drain)));
		expect(await inspectRelayedTransaction(wire, ctx(w))).toMatchObject({ ok: false });
	});
});

describe('fee payer break-even', () => {
	const fee = 13_000n;
	it('requires the payment to be exactly the fee plus the rent actually taken', () => {
		expect(breaksEven({ payment: fee, fee, rent: 0n, feePayerChange: 0n })).toBe(true);
		expect(breaksEven({ payment: fee + RENT, fee, rent: RENT, feePayerChange: 0n })).toBe(true);
		// Simulation charges the fee, so a fee payer that comes out up is a mismatch too.
		expect(breaksEven({ payment: fee, fee, rent: 0n, feePayerChange: fee })).toBe(false);
		// Underpaying or overpaying, or a pre-funded address making the rent smaller.
		expect(breaksEven({ payment: fee - 1n, fee, rent: 0n, feePayerChange: -1n })).toBe(false);
		expect(breaksEven({ payment: fee + 1n, fee, rent: 0n, feePayerChange: 1n })).toBe(false);
		expect(
			breaksEven({ payment: fee + RENT, fee, rent: RENT - 1_000n, feePayerChange: 1_000n })
		).toBe(false);
		// Any other loss of the fee payer's.
		expect(breaksEven({ payment: fee, fee, rent: 0n, feePayerChange: -5n })).toBe(false);
	});
});

describe('Revibase Passkey sign-in', () => {
	async function setup() {
		const w = await passkeyWallet();
		const prove = async (text: string, rpIdHash = SIGNER_RP_HASH) => {
			const clientData = new TextEncoder().encode(
				JSON.stringify({
					type: 'webauthn.get',
					challenge: bytesToBase64Url(
						await buildSignMessageChallenge(new TextEncoder().encode(text))
					),
					origin: `https://${SIGNER_RP_ID}`
				})
			);
			const authenticatorData = new Uint8Array(37);
			authenticatorData.set(rpIdHash);
			authenticatorData[32] = 0x01;
			const signed = new Uint8Array([...authenticatorData, ...sha256(clientData)]);
			const signature = p256.Signature.fromBytes(p256.sign(signed, w.secret), 'compact').toBytes(
				'der'
			);
			return bytesToBase64Url(
				framePasskeyMessageProof({ authenticatorData, clientDataJSON: clientData, signature })
			);
		};
		return { w, prove, passkey: { signerRpIdHash: SIGNER_RP_HASH } };
	}

	const site = (address: string) => ({
		domain: 'portal.revibase.com',
		uri: 'https://portal.revibase.com',
		address,
		cluster: 'mainnet'
	});

	it('accepts a passkey proof for the vault derived from its key, before the wallet exists', async () => {
		const { w, prove, passkey } = await setup();
		const db = createTestD1([MIGRATIONS]);
		const { challengeId, message } = await issueOwnerLoginChallenge(db, site(w.vault));
		const body = {
			challengeId,
			address: w.vault,
			signature: await prove(message),
			passkeyPublicKey: bytesToBase64Url(w.publicKey)
		};
		expect(await verifyOwnerLogin(db, body, Date.now(), passkey)).toEqual({
			ok: true,
			wallet: w.vault
		});
	});

	it('rejects another RP, another key’s vault, or a passkey-less server', async () => {
		const { w, prove, passkey } = await setup();
		const db = createTestD1([MIGRATIONS]);
		const login = async (signature: string, publicKey: Uint8Array, p = passkey) => {
			const { challengeId, message } = await issueOwnerLoginChallenge(db, site(w.vault));
			return verifyOwnerLogin(
				db,
				{
					challengeId,
					address: w.vault,
					signature: signature || (await prove(message)),
					passkeyPublicKey: bytesToBase64Url(publicKey)
				},
				Date.now(),
				p
			);
		};
		const { message } = await issueOwnerLoginChallenge(db, site(w.vault));
		expect(await login(await prove(message, new Uint8Array(32)), w.publicKey)).toMatchObject({
			ok: false
		});
		expect(await login('', (await passkeyWallet()).publicKey)).toMatchObject({ ok: false });
		expect(await login('', w.publicKey, null as never)).toMatchObject({ ok: false });
	});
});
