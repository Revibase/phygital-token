import { beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
	address,
	appendTransactionMessageInstructions,
	createKeyPairSignerFromBytes,
	createNoopSigner,
	createTransactionMessage,
	getAddressEncoder,
	getBase58Decoder,
	getTransactionEncoder,
	partiallySignTransactionMessageWithSigners,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageComputeUnitLimit,
	setTransactionMessageComputeUnitPrice,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Blockhash,
	type Instruction,
	type KeyPairSigner,
	type Rpc,
	type SolanaRpcApi
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
	buildExecuteWithOwnerInstruction,
	findPolicyPda,
	findWalletPda,
	getRefillInstruction,
	getRemoveOwnerInstruction,
	getSetOwnerInstruction,
	getUpdatePolicyInstructionAsync,
	PHYGITAL_TOKEN_DISCRIMINATOR,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS
} from 'phygital-token-sdk';

import { inspectSponsored, SponsorError } from '$lib/server/sponsor/inspect';
import { prepaidBalance, reserve, settlePending } from '$lib/server/sponsor/ledger';
import { resetSponsorPool } from '$lib/server/sponsor/pool';
import { signSponsored, sponsorInfo } from '$lib/server/sponsor/service';
import type { ServerEnv } from '$lib/server/env';
import { base64ToBytes } from '$lib/shared/encoding';
import { createTestD1, MIGRATIONS } from './support/d1-sqlite';

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const BLOCKHASH = '11111111111111111111111111111111' as Blockhash;
const CAPS = { maxComputeUnitLimit: 400_000, maxComputeUnitPrice: 100_000n };

async function keypair(): Promise<{ signer: KeyPairSigner; secret: string }> {
	const seed = ed25519.utils.randomSecretKey();
	const bytes = new Uint8Array([...seed, ...ed25519.getPublicKey(seed)]);
	return {
		signer: await createKeyPairSignerFromBytes(bytes),
		secret: getBase58Decoder().decode(bytes)
	};
}

let poolKey: Awaited<ReturnType<typeof keypair>>;
let otherPoolKey: Awaited<ReturnType<typeof keypair>>;
let owner: KeyPairSigner;
let wallet: Address;
let pool: Set<Address>;

beforeEach(async () => {
	poolKey = await keypair();
	otherPoolKey = await keypair();
	owner = (await keypair()).signer;
	[wallet] = await findWalletPda({ phygitalToken: TOKEN });
	pool = new Set([poolKey.signer.address, otherPoolKey.signer.address]);
	resetSponsorPool();
});

async function build(
	instructions: Instruction[],
	opts: { feePayer?: Address; limit?: number | null; price?: bigint; unsign?: boolean } = {}
): Promise<Uint8Array> {
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayer(opts.feePayer ?? poolKey.signer.address, m),
		(m) =>
			setTransactionMessageLifetimeUsingBlockhash(
				{ blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
				m
			),
		(m) => appendTransactionMessageInstructions(instructions, m),
		(m) =>
			opts.limit === null ? m : setTransactionMessageComputeUnitLimit(opts.limit ?? 200_000, m),
		(m) => setTransactionMessageComputeUnitPrice(opts.price ?? 50_000n, m)
	);
	const signed = await partiallySignTransactionMessageWithSigners(message);
	const tx = opts.unsign
		? { ...signed, signatures: { ...signed.signatures, [owner.address]: null } }
		: signed;
	return new Uint8Array(getTransactionEncoder().encode(tx));
}

const refill = async (lamports: bigint, feePayer = poolKey.signer.address) =>
	buildExecuteWithOwnerInstruction({
		owner,
		phygitalToken: TOKEN,
		instructions: [getRefillInstruction(wallet, feePayer, lamports)]
	});

const updatePolicy = (payer: Address) =>
	getUpdatePolicyInstructionAsync({
		owner,
		payer: payer === owner.address ? owner : createNoopSigner(payer),
		phygitalToken: TOKEN,
		actions: []
	});

/** A well-formed transaction signature, for ledger rows. */
const sig = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));

async function removeOwner() {
	const [policy] = await findPolicyPda({ phygitalToken: TOKEN });
	return getRemoveOwnerInstruction({ owner, phygitalToken: TOKEN, policy, wallet });
}

function rejection(fn: () => unknown): SponsorError {
	try {
		fn();
	} catch (err) {
		if (err instanceof SponsorError) return err;
		throw err;
	}
	throw new Error('expected a SponsorError');
}

describe('sponsor checks', () => {
	it('sponsors an owner action and prices its fee', async () => {
		const tx = inspectSponsored(await build([await removeOwner()]), pool, CAPS);
		expect(tx.accessory).toBe(TOKEN);
		expect(tx.feePayer).toBe(poolKey.signer.address);
		expect(tx.fundsPolicy).toBe(false);
		expect(tx.refill).toBe(0n);
		expect(tx.fee).toBe(2n * 5_000n + 10_000n);
	});

	it('lets the fee payer fund a new tap-payments account', async () => {
		const tx = inspectSponsored(
			await build([await updatePolicy(poolKey.signer.address)]),
			pool,
			CAPS
		);
		expect(tx.fundsPolicy).toBe(true);
		expect(tx.policy).toBe((await findPolicyPda({ phygitalToken: TOKEN }))[0]);
	});

	it('rejects a pool key funding tap payments without being the fee payer', async () => {
		const wire = await build([await updatePolicy(otherPoolKey.signer.address)]);
		expect(rejection(() => inspectSponsored(wire, pool, CAPS)).code).toBe('not_sponsorable');
	});

	it('reads a refill and rejects any other use of the fee payer inside an execute', async () => {
		const ok = inspectSponsored(
			await build([await updatePolicy(owner.address), await refill(4_990_000n)]),
			pool,
			CAPS
		);
		expect(ok.refill).toBe(4_990_000n);

		const drain = await buildExecuteWithOwnerInstruction({
			owner,
			phygitalToken: TOKEN,
			instructions: [
				getTransferSolInstruction({
					source: createNoopSigner(poolKey.signer.address),
					destination: wallet,
					amount: 1n
				})
			]
		});
		const wire = await build([drain]);
		expect(rejection(() => inspectSponsored(wire, pool, CAPS)).message).toMatch(/refill/);
	});

	it('rejects programs it does not sponsor, and a second action', async () => {
		const transfer = getTransferSolInstruction({ source: owner, destination: wallet, amount: 1n });
		const wire = await build([await removeOwner(), transfer]);
		expect(rejection(() => inspectSponsored(wire, pool, CAPS)).code).toBe('not_sponsorable');
		const two = await build([await removeOwner(), await updatePolicy(owner.address)]);
		expect(rejection(() => inspectSponsored(two, pool, CAPS)).code).toBe('not_sponsorable');
	});

	it('puts the refill after a link and before an unlink', async () => {
		const [policy] = await findPolicyPda({ phygitalToken: TOKEN });
		const link = getSetOwnerInstruction({
			recipient: owner,
			phygitalToken: TOKEN,
			policy,
			wallet,
			slotNumber: 1n,
			secp256r1VerifyArgs: {
				verifyArgsRelativeIndex: -1,
				signedMessageIndex: 0,
				clientDataJson: new Uint8Array(4)
			}
		});
		expect(inspectSponsored(await build([link, await refill(5_000_000n)]), pool, CAPS).refill).toBe(
			5_000_000n
		);
		const early = await build([await refill(5_000_000n), link]);
		expect(rejection(() => inspectSponsored(early, pool, CAPS)).message).toMatch(/after linking/);
		const late = await build([await removeOwner(), await refill(5_000_000n)]);
		expect(rejection(() => inspectSponsored(late, pool, CAPS)).message).toMatch(/before unlinking/);
	});

	it('signs before the owner has (it can’t land without them), but every signature present must be valid', async () => {
		const unsigned = await build([await removeOwner()], { unsign: true });
		expect(inspectSponsored(unsigned, pool, CAPS).accessory).toBe(TOKEN);
		const tampered = await build([await removeOwner()]);
		tampered[1 + 64 + 5] ^= 1; // the owner's signature (the fee payer's slot comes first)
		expect(rejection(() => inspectSponsored(tampered, pool, CAPS)).code).toBe('invalid_signature');
	});

	it('keeps fees within the caps and the fee payer in the pool', async () => {
		const ix = await removeOwner();
		const noLimit = await build([ix], { limit: null });
		expect(rejection(() => inspectSponsored(noLimit, pool, CAPS)).code).toBe('fee_caps');
		const pricey = await build([ix], { price: 200_000n });
		expect(rejection(() => inspectSponsored(pricey, pool, CAPS)).code).toBe('fee_caps');
		const stranger = await build([ix], { feePayer: owner.address });
		expect(rejection(() => inspectSponsored(stranger, pool, CAPS)).code).toBe('fee_payer_unknown');
	});
});

describe('prepaid fee ledger', () => {
	const PREPAID = 5_000_000n;
	const charge = (signature: string, cost: bigint, refill = 0n) => ({
		signature,
		accessory: TOKEN,
		feePayer: 'pool',
		fee: cost,
		cost,
		refill,
		blockhash: BLOCKHASH
	});

	it('spends down, refuses past zero, and lets a refill cover its own transaction', async () => {
		const db = createTestD1([MIGRATIONS]);
		const [a, b] = [sig(), sig()];
		expect(await reserve(db, PREPAID, charge(a, 4_000_000n))).toBe(true);
		expect(await reserve(db, PREPAID, charge(b, 2_000_000n))).toBe(false);
		expect(await reserve(db, PREPAID, charge(b, 2_000_000n, 6_000_000n))).toBe(true);
		// The pending refill doesn't count for anyone else yet.
		expect(await prepaidBalance(db, TOKEN, PREPAID)).toBe(-1_000_000n);
		expect(await reserve(db, PREPAID, charge(a, 4_000_000n))).toBe(true);
	});

	it('settles: confirmed refills count, failed ones only cost their fee, dropped ones nothing', async () => {
		const db = createTestD1([MIGRATIONS]);
		const [landed, failed, expired] = [sig(), sig(), sig()];
		await reserve(db, PREPAID, { ...charge(landed, 3_000_000n, 3_000_000n), fee: 10_000n });
		await reserve(db, PREPAID, { ...charge(failed, 1_000_000n), fee: 10_000n });
		await reserve(db, PREPAID, charge(expired, 500_000n));
		const statuses: Record<string, unknown> = {
			[landed]: { confirmationStatus: 'confirmed', err: null },
			[failed]: { confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } },
			[expired]: null
		};
		const rpc = {
			getSignatureStatuses: (sigs: string[]) => ({
				send: async () => ({ value: sigs.map((s) => statuses[s]) })
			}),
			isBlockhashValid: () => ({ send: async () => ({ value: false }) })
		} as unknown as Rpc<SolanaRpcApi>;
		await settlePending(db, rpc, TOKEN);
		expect(await prepaidBalance(db, TOKEN, PREPAID)).toBe(
			PREPAID - 3_000_000n + 3_000_000n - 10_000n
		);
	});
});

describe('signSponsored', () => {
	function env(db: D1Database): ServerEnv {
		return {
			db,
			sponsor: {
				keys: `${poolKey.secret},${otherPoolKey.secret}`,
				prepaidLamports: 5_000_000n,
				maxComputeUnitLimit: 400_000,
				maxComputeUnitPrice: 100_000n,
				minKeyLamports: 1n
			}
		} as ServerEnv;
	}

	function rpc(opts: { feePayerDrop?: bigint; err?: unknown } = {}) {
		const head = Buffer.from(new Uint8Array(PHYGITAL_TOKEN_DISCRIMINATOR)).toString('base64');
		return {
			getAccountInfo: () => ({
				send: async () => ({
					value: { owner: PHYGITAL_TOKEN_PROGRAM_ADDRESS, data: [head, 'base64'] }
				})
			}),
			getMultipleAccounts: (addrs: string[]) => ({
				send: async () => ({ value: addrs.map(() => ({ lamports: 1_000_000_000n })) })
			}),
			simulateTransaction: () => ({
				send: async () => ({
					value: {
						err: opts.err ?? null,
						logs: [],
						accounts: [{ lamports: 1_000_000_000n - (opts.feePayerDrop ?? 20_000n) }]
					}
				})
			}),
			getSignatureStatuses: (sigs: string[]) => ({
				send: async () => ({ value: sigs.map(() => null) })
			}),
			isBlockhashValid: () => ({ send: async () => ({ value: true }) })
		} as unknown as Rpc<SolanaRpcApi>;
	}

	it('signs with the pool key, charges the prepaid fees, and re-signs the same message for free', async () => {
		const db = createTestD1([MIGRATIONS]);
		const bytes = await build([await removeOwner()]);
		const encoded = Buffer.from(bytes).toString('base64');
		const { signatures } = await signSponsored(env(db), rpc(), [encoded]);
		const signature = base64ToBytes(signatures[0]);
		const message = bytes.subarray(1 + 64 * 2);
		expect(
			ed25519.verify(
				signature,
				message,
				new Uint8Array(getAddressEncoder().encode(poolKey.signer.address))
			)
		).toBe(true);
		expect(await prepaidBalance(db, TOKEN, 5_000_000n)).toBe(5_000_000n - 20_000n);
		await signSponsored(env(db), rpc(), [encoded]);
		expect(await prepaidBalance(db, TOKEN, 5_000_000n)).toBe(5_000_000n - 20_000n);
	});

	it('asks for a refill once the prepaid fees are used up', async () => {
		const db = createTestD1([MIGRATIONS]);
		await reserve(db, 5_000_000n, {
			signature: sig(),
			accessory: TOKEN,
			feePayer: 'x',
			fee: 4_995_000n,
			cost: 4_995_000n,
			refill: 0n,
			blockhash: BLOCKHASH
		});
		const encoded = Buffer.from(await build([await removeOwner()])).toString('base64');
		const err = await signSponsored(env(db), rpc(), [encoded]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(SponsorError);
		expect((err as SponsorError).status).toBe(402);
		expect((err as SponsorError).details?.neededLamports).toBe(
			String(5_000_000n - 5_000n + 20_000n)
		);
	});

	it('charges nothing for a batch that is refused part-way', async () => {
		const db = createTestD1([MIGRATIONS]);
		// Room for one 20_000 transaction, not two.
		await reserve(db, 5_000_000n, {
			signature: sig(),
			accessory: TOKEN,
			feePayer: 'x',
			fee: 4_970_000n,
			cost: 4_970_000n,
			refill: 0n,
			blockhash: BLOCKHASH
		});
		const before = await prepaidBalance(db, TOKEN, 5_000_000n);
		const first = Buffer.from(await build([await removeOwner()], { limit: 200_000 })).toString(
			'base64'
		);
		const second = Buffer.from(await build([await removeOwner()], { limit: 200_001 })).toString(
			'base64'
		);
		const err = await signSponsored(env(db), rpc(), [first, second]).catch((e: unknown) => e);
		expect((err as SponsorError).status).toBe(402);
		expect(await prepaidBalance(db, TOKEN, 5_000_000n)).toBe(before);
	});

	it('keeps an earlier charge when a re-sent transaction is part of a refused batch', async () => {
		const db = createTestD1([MIGRATIONS]);
		const earlier = Buffer.from(await build([await removeOwner()], { limit: 200_000 })).toString(
			'base64'
		);
		await signSponsored(env(db), rpc(), [earlier]);
		const charged = await prepaidBalance(db, TOKEN, 5_000_000n);
		await reserve(db, 5_000_000n, {
			signature: sig(),
			accessory: TOKEN,
			feePayer: 'x',
			fee: charged - 10_000n,
			cost: charged - 10_000n,
			refill: 0n,
			blockhash: BLOCKHASH
		});
		const after = await prepaidBalance(db, TOKEN, 5_000_000n);
		const fresh = Buffer.from(await build([await removeOwner()], { limit: 200_001 })).toString(
			'base64'
		);
		const err = await signSponsored(env(db), rpc(), [earlier, fresh]).catch((e: unknown) => e);
		expect((err as SponsorError).status).toBe(402);
		// The earlier signature was already handed out, so its charge stays.
		expect(await prepaidBalance(db, TOKEN, 5_000_000n)).toBe(after);
	});

	it('refuses a transaction that would cost the pool more than its fee', async () => {
		const db = createTestD1([MIGRATIONS]);
		const encoded = Buffer.from(await build([await removeOwner()])).toString('base64');
		const err = await signSponsored(env(db), rpc({ feePayerDrop: 1_000_000n }), [encoded]).catch(
			(e: unknown) => e
		);
		expect((err as SponsorError).message).toMatch(/more of our SOL/);
	});

	it('reports the pool, caps and an accessory balance', async () => {
		const db = createTestD1([MIGRATIONS]);
		const info = await sponsorInfo(env(db), rpc(), TOKEN);
		expect(new Set(info.feePayers)).toEqual(pool);
		expect(info).toMatchObject({
			maxComputeUnitLimit: 400_000,
			maxComputeUnitPrice: '100000',
			prepaidLamports: '5000000',
			balanceLamports: '5000000'
		});
	});
});

describe('v1 sponsorship', () => {
	async function v1(priorityFeeLamports: bigint) {
		const message = pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayer(poolKey.signer.address, m),
			(m) =>
				setTransactionMessageLifetimeUsingBlockhash(
					{ blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
					m
				),
			(m) =>
				setTransactionMessageConfig(
					{
						computeUnitLimit: 200_000,
						loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
						priorityFeeLamports
					},
					m
				)
		);
		const tx = await partiallySignTransactionMessageWithSigners(
			appendTransactionMessageInstructions([await removeOwner()], message)
		);
		return new Uint8Array(getTransactionEncoder().encode(tx));
	}
	it('uses the signed total priority fee when charging prepaid fees', async () => {
		const inspected = inspectSponsored(await v1(10_000n), pool, CAPS);
		expect(inspected.fee).toBe(20_000n);
	});
	it('rejects a v1 priority fee above the sponsorship cap', async () => {
		const wire = await v1(40_001n);
		expect(() => inspectSponsored(wire, pool, CAPS)).toThrow(/Priority fee/);
	});
});
