import { describe, expect, it } from 'vitest';
import {
	appendTransactionMessageInstruction,
	blockhash,
	compileTransaction,
	createNoopSigner,
	decompileTransactionMessage,
	generateKeyPairSigner,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionEncoder
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';

import { base64UrlToBytes } from '#lib/shared/encoding.ts';
import {
	buildLinkTransactionFromTap,
	expectationFromTap,
	LinkTransactionRejected,
	validateLinkTransaction
} from '#lib/shared/link-transaction.ts';
import { LIGHTHOUSE_PROGRAM_ADDRESS } from '#lib/shared/addresses.ts';
import { fakeAccessory, fakeTap } from './support/fixtures';

const BLOCKHASH = {
	blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
	lastValidBlockHeight: 100n
};

describe('direct browser claim transaction', () => {
	it('builds and validates the WebAuthn proof and set_owner instruction', async () => {
		const { tap, recipient } = await fakeTap();
		const { wireBytes } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
		const expectation = await expectationFromTap(tap, recipient.address);
		expect(() => validateLinkTransaction(wireBytes, expectation)).not.toThrow();
	});

	it('rejects a different wallet than the one approving', async () => {
		const { tap, recipient } = await fakeTap();
		const { wireBytes } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
		const expectation = await expectationFromTap(
			tap,
			String((await generateKeyPairSigner()).address)
		);
		expect(() => validateLinkTransaction(wireBytes, expectation)).toThrow(LinkTransactionRejected);
	});

	it('rejects a different accessory, slot, or tap data', async () => {
		const { tap, recipient } = await fakeTap();
		const { wireBytes } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
		const expectation = await expectationFromTap(tap, recipient.address);
		const other = fakeAccessory();
		expect(() =>
			validateLinkTransaction(wireBytes, { ...expectation, secp256r1Pubkey: other.publicKey })
		).toThrow(/different accessory/);
		expect(() =>
			validateLinkTransaction(wireBytes, {
				...expectation,
				phygitalToken: String(recipient.address)
			})
		).toThrow(/phygital token/);
		expect(() => validateLinkTransaction(wireBytes, { ...expectation, slotNumber: 1n })).toThrow(
			/slot/
		);
		expect(() =>
			validateLinkTransaction(wireBytes, { ...expectation, clientDataJson: new Uint8Array([1]) })
		).toThrow(/tap data/);
	});

	it('rejects smuggled instructions and extra signers', async () => {
		const { tap, recipient } = await fakeTap();
		const { transaction } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
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
		const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(drain)));
		const expectation = await expectationFromTap(tap, recipient.address);
		expect(() => validateLinkTransaction(bytes, expectation)).toThrow(/unexpected program/);
	});

	it('only allows wallet-added Lighthouse and compute budget instructions on the signed copy', async () => {
		const { tap, recipient } = await fakeTap();
		const { transaction } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
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
		const expectation = await expectationFromTap(tap, recipient.address);
		expect(() => validateLinkTransaction(bytes, expectation)).toThrow(LinkTransactionRejected);
		expect(() =>
			validateLinkTransaction(bytes, expectation, { allowWalletAdditions: true })
		).not.toThrow();
	});

	it('round-trips through the wire decoder', async () => {
		const { tap, recipient } = await fakeTap();
		const { wireBytes } = await buildLinkTransactionFromTap({
			tap,
			recipient,
			blockhash: BLOCKHASH
		});
		const decoded = getTransactionDecoder().decode(wireBytes);
		expect(Object.keys(decoded.signatures)).toEqual([recipient.address]);
		expect(base64UrlToBytes(tap.response.response.clientDataJSON).length).toBeGreaterThan(0);
	});
});
