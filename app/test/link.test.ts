import { describe, expect, it } from 'vitest';
import {
	appendTransactionMessageInstruction,
	setTransactionMessageFeePayer,
	blockhash,
	compileTransaction,
	createNoopSigner,
	decompileTransactionMessage,
	generateKeyPairSigner,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionEncoder,
	type Rpc,
	type SolanaRpcApi
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';

import { base64UrlToBytes } from '$lib/shared/encoding';
import { buildRefillInstruction } from '$lib/shared/wallet-instructions';
import {
	buildLinkTransaction,
	linkExpectation,
	LinkTransactionRejected,
	validateLinkTransaction
} from '$lib/shared/link-transaction';
import { LIGHTHOUSE_PROGRAM_ADDRESS } from '$lib/shared/addresses';
import { fakeAccessory, fakeTap } from './support/fixtures';

// completeTransfer only looks up the accessory policy (none here).
const rpc = {
	getAccountInfo: () => ({ send: async () => ({ value: null }) })
} as unknown as Rpc<SolanaRpcApi>;
const BLOCKHASH = {
	blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
	lastValidBlockHeight: 100n
};

describe('link transaction (SDK completeTransfer) + validator', () => {
	it('builds [budget, budget, secp256r1_verify, set_owner] that validates', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { wireBytes } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		expect(() =>
			validateLinkTransaction(wireBytes, linkExpectation(tap, recipient.address))
		).not.toThrow();
	});

	it('rejects a different wallet than the one approving', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { wireBytes } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const someoneElse = (await generateKeyPairSigner()).address;
		expect(() => validateLinkTransaction(wireBytes, linkExpectation(tap, someoneElse))).toThrow(
			LinkTransactionRejected
		);
	});

	it('rejects a different accessory, slot, or tap data', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { wireBytes } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const exp = linkExpectation(tap, recipient.address);
		const other = fakeAccessory();
		expect(() =>
			validateLinkTransaction(wireBytes, { ...exp, secp256r1Pubkey: other.publicKey })
		).toThrow(/different accessory/);
		expect(() =>
			validateLinkTransaction(wireBytes, { ...exp, phygitalToken: String(recipient.address) })
		).toThrow(/phygital token/);
		expect(() => validateLinkTransaction(wireBytes, { ...exp, slotNumber: 1n })).toThrow(/slot/);
		expect(() =>
			validateLinkTransaction(wireBytes, { ...exp, clientDataJson: new Uint8Array([1]) })
		).toThrow(/tap data/);
	});

	it('rejects smuggled instructions and extra signers', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { transaction } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const message = decompileTransactionMessage(
			getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
		);
		const attacker = await generateKeyPairSigner();

		const drain = appendTransactionMessageInstruction(
			getTransferSolInstruction({
				source: createNoopSigner(recipient.address),
				destination: attacker.address,
				amount: 1n
			}),
			message
		);
		const drainBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(drain)));
		expect(() =>
			validateLinkTransaction(drainBytes, linkExpectation(tap, recipient.address))
		).toThrow(/unexpected program/);
	});

	it('tolerates wallet-added Lighthouse and compute-budget instructions only on the signed copy', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { transaction } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const message = decompileTransactionMessage(
			getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
		);
		const guard = {
			programAddress: LIGHTHOUSE_PROGRAM_ADDRESS,
			accounts: [],
			data: new Uint8Array([1])
		};
		const wrapped = appendTransactionMessageInstruction(guard, {
			...message,
			instructions: [
				getSetComputeUnitLimitInstruction({ units: 100_000 }),
				guard,
				...message.instructions
			]
		});
		const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(wrapped)));
		const exp = linkExpectation(tap, recipient.address);
		expect(() => validateLinkTransaction(bytes, exp)).toThrow(LinkTransactionRejected);
		expect(() => validateLinkTransaction(bytes, exp, { allowWalletAdditions: true })).not.toThrow();
	});

	it('accepts a Revibase fee payer and its refill right after set_owner, exactly as built', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { transaction } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const message = decompileTransactionMessage(
			getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
		);
		const pool = await generateKeyPairSigner();
		const refill = await buildRefillInstruction(
			recipient,
			tap.session.phygitalToken,
			pool.address,
			5_000_000n
		);
		const sponsored = (instructions: typeof message.instructions) =>
			new Uint8Array(
				getTransactionEncoder().encode(
					compileTransaction(
						setTransactionMessageFeePayer(pool.address, { ...message, instructions })
					)
				)
			);
		const exp = { ...linkExpectation(tap, recipient.address), feePayer: pool.address, refill };

		expect(() =>
			validateLinkTransaction(sponsored([...message.instructions, refill]), exp)
		).not.toThrow();
		expect(() => validateLinkTransaction(sponsored(message.instructions), exp)).toThrow(/refill/);
		expect(() =>
			validateLinkTransaction(
				sponsored([...message.instructions, refill]),
				linkExpectation(tap, recipient.address)
			)
		).toThrow(/fee payer/);
		const larger = await buildRefillInstruction(
			recipient,
			tap.session.phygitalToken,
			pool.address,
			9_000_000n
		);
		expect(() =>
			validateLinkTransaction(sponsored([...message.instructions, larger]), exp)
		).toThrow(LinkTransactionRejected);
		const [secp, link] = message.instructions.slice(-2);
		expect(() =>
			validateLinkTransaction(
				sponsored([...message.instructions.slice(0, -2), refill, secp, link]),
				exp
			)
		).toThrow(LinkTransactionRejected);
	});

	it('rejects garbage bytes', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		expect(() =>
			validateLinkTransaction(new Uint8Array([1, 2, 3]), linkExpectation(tap, recipient.address))
		).toThrow(LinkTransactionRejected);
	});

	it('round-trips through the wire decoder', async () => {
		const { tap, recipient } = await fakeTap(rpc);
		const { wireBytes } = await buildLinkTransaction({ tap, recipient, blockhash: BLOCKHASH });
		const decoded = getTransactionDecoder().decode(wireBytes);
		expect(Object.keys(decoded.signatures)).toEqual([recipient.address]);
		expect(base64UrlToBytes(tap.response.response.clientDataJSON).length).toBeGreaterThan(0);
	});
});
