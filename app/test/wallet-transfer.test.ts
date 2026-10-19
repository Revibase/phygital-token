import { describe, expect, it } from 'vitest';
import {
	appendTransactionMessageInstructions,
	blockhash,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	generateKeyPairSigner,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Instruction
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

import { LIGHTHOUSE_PROGRAM_ADDRESS } from '#lib/shared/addresses.ts';
import {
	messageFeeLamports,
	networkFeeLamports,
	TRANSFER_TX_CONFIG
} from '#lib/shared/wallet-fee.ts';
import type { TokenHolding, WalletHoldings } from '#lib/shared/wallet-holdings.ts';
import {
	assertTransferIntact,
	buildTransferTransaction,
	maxSendable,
	needsSolForFees,
	SYSTEM_ACCOUNT_RENT_LAMPORTS,
	TOKEN_ACCOUNT_RENT_LAMPORTS,
	transferCost,
	transferFeeLamports,
	transferProblem,
	TransferRejected,
	type TransferRequest
} from '#lib/shared/wallet-transfer.ts';
import { decodeMessage } from '#lib/shared/passkey-transaction.ts';

const BLOCKHASH = {
	blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
	lastValidBlockHeight: 100n
};
const SOL = 1_000_000_000n;

const addr = async () => (await generateKeyPairSigner()).address;

async function token(overrides: Partial<TokenHolding> = {}): Promise<TokenHolding> {
	return {
		tokenAccount: await addr(),
		mint: await addr(),
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
		amount: 1_000_000n,
		decimals: 6,
		frozen: false,
		name: 'Test',
		symbol: 'TST',
		icon: null,
		priceUsd: null,
		...overrides
	};
}

const holdings = (
	wallet: Address,
	lamports: bigint,
	tokens: TokenHolding[] = []
): WalletHoldings => ({
	wallet,
	lamports,
	tokens,
	solPriceUsd: null
});

async function setup() {
	const owner = await addr();
	const recipient = await addr();
	const feePayer = await addr();
	return { owner, recipient, feePayer };
}

describe('network fee', () => {
	it('charges every signature, precompiles included, plus the priority fee', () => {
		// A passkey claim on localnet: fee payer + two secp256r1 verifies, 3000 priority = 18000.
		expect(networkFeeLamports(3, TRANSFER_TX_CONFIG)).toBe(18_000n);
		expect(transferFeeLamports(false)).toBe(8_000n);
		expect(transferFeeLamports(true)).toBe(13_000n);
	});

	it('reads the same fee back from a decoded transaction', async () => {
		const { owner, recipient } = await setup();
		const request: TransferRequest = {
			owner,
			asset: { kind: 'sol' },
			recipient,
			amount: SOL,
			openAccount: false
		};
		const { wireBytes } = await buildTransferTransaction(request, owner, BLOCKHASH);
		expect(messageFeeLamports(decodeMessage(wireBytes))).toBe(transferFeeLamports(false));
	});
});

describe('buildTransferTransaction', () => {
	it('sends SOL as v1 with the transfer budget, paid by an ordinary wallet itself', async () => {
		const { owner, recipient } = await setup();
		const { wireBytes, instructions } = await buildTransferTransaction(
			{ owner, asset: { kind: 'sol' }, recipient, amount: SOL, openAccount: false },
			owner,
			BLOCKHASH
		);
		const message = decodeMessage(wireBytes);
		expect(message.version).toBe(1);
		expect(message.config).toEqual(TRANSFER_TX_CONFIG);
		expect(message.feePayer).toBe(owner);
		expect(instructions.map((ix) => ix.programAddress)).toEqual([SYSTEM_PROGRAM_ADDRESS]);
	});

	it('opens the recipient’s token account, paid by the sender, only when asked', async () => {
		const { owner, recipient } = await setup();
		const t = await token();
		const send = (openAccount: boolean) =>
			buildTransferTransaction(
				{ owner, asset: { kind: 'token', token: t }, recipient, amount: 10n, openAccount },
				owner,
				BLOCKHASH
			);
		const opened = await send(true);
		expect(opened.instructions.map((ix) => ix.programAddress)).toEqual([
			ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
			TOKEN_PROGRAM_ADDRESS
		]);
		expect(opened.instructions[0].accounts?.[0]?.address).toBe(owner);
		const plain = await send(false);
		expect(plain.instructions.map((ix) => ix.programAddress)).toEqual([TOKEN_PROGRAM_ADDRESS]);
		expect(plain.instructions[0].accounts?.[3]?.address).toBe(owner);
	});
});

describe('what can be sent', () => {
	it('reserves the fee, any new token account, and (for an ordinary wallet) the rent minimum', async () => {
		const { owner } = await setup();
		const h = holdings(owner, SOL);
		const fee = transferFeeLamports(false);
		expect(maxSendable(h, { kind: 'sol' }, false, false)).toBe(
			SOL - fee - SYSTEM_ACCOUNT_RENT_LAMPORTS
		);
		// A passkey vault may be emptied.
		expect(maxSendable(h, { kind: 'sol' }, true, false)).toBe(SOL - transferFeeLamports(true));
		expect(maxSendable(holdings(owner, 1n), { kind: 'sol' }, true, false)).toBe(0n);
	});

	it('explains in plain words why a transfer can’t go', async () => {
		const { owner, recipient } = await setup();
		const t = await token();
		const sol = (amount: bigint): TransferRequest => ({
			owner,
			asset: { kind: 'sol' },
			recipient,
			amount,
			openAccount: false
		});
		const h = holdings(owner, SOL, [t]);
		expect(transferProblem(sol(SOL / 2n), h, false, SOL)).toBeNull();
		expect(transferProblem({ ...sol(1n), recipient: owner }, h, false, SOL)).toMatch(/own address/);
		expect(transferProblem(sol(SOL), h, false, SOL)).toMatch(/Not enough SOL/);
		// Leaving dust behind isn't possible; the max is.
		const dust = SOL - transferFeeLamports(true) - 1n;
		expect(transferProblem(sol(dust), h, true, SOL)).toMatch(/Leave at least/);
		expect(transferProblem(sol(SOL - transferFeeLamports(true)), h, true, SOL)).toBeNull();
		expect(transferProblem(sol(1_000n), h, false, 0n)).toMatch(/new address/);

		const tokenSend: TransferRequest = {
			owner,
			asset: { kind: 'token', token: t },
			recipient,
			amount: 10n,
			openAccount: true
		};
		expect(transferCost(tokenSend, true).solOut).toBe(
			transferFeeLamports(true) + TOKEN_ACCOUNT_RENT_LAMPORTS
		);
		expect(transferProblem(tokenSend, holdings(owner, 10_000n, [t]), true, 0n)).toMatch(
			/Add a little SOL/
		);
		expect(needsSolForFees(holdings(owner, 10_000n), true)).toBe(true);
		expect(needsSolForFees(holdings(owner, SOL), true)).toBe(false);
	});

	it('adds a passkey wallet’s one-time setup to its first transaction', async () => {
		const { owner, recipient } = await setup();
		const setupRent = 1_948_800n;
		const send: TransferRequest = {
			owner,
			asset: { kind: 'sol' },
			recipient,
			amount: SOL / 10n,
			openAccount: false
		};
		const cost = transferCost(send, true, setupRent);
		expect(cost.setup).toBe(setupRent);
		expect(cost.solOut).toBe(SOL / 10n + transferFeeLamports(true) + setupRent);
		const h = holdings(owner, SOL);
		expect(maxSendable(h, { kind: 'sol' }, true, false, setupRent)).toBe(
			SOL - transferFeeLamports(true) - setupRent
		);
		// Enough for the fee alone isn't enough for the first transaction.
		const thin = holdings(owner, 1_000_000n);
		expect(needsSolForFees(thin, true)).toBe(false);
		expect(needsSolForFees(thin, true, setupRent)).toBe(true);
		expect(transferProblem({ ...send, amount: 900_000n }, thin, true, SOL, setupRent)).toMatch(
			/Not enough SOL/
		);
	});
});

describe('assertTransferIntact', () => {
	async function signed(owner: Address, instructions: Instruction[]) {
		const message = pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayer(owner, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(BLOCKHASH, m),
			(m) => setTransactionMessageConfig(TRANSFER_TX_CONFIG, m),
			(m) => appendTransactionMessageInstructions(instructions, m)
		);
		return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
	}

	it('accepts wallet guards and rejects a changed transfer', async () => {
		const { owner, recipient } = await setup();
		const { instructions, wireBytes } = await buildTransferTransaction(
			{ owner, asset: { kind: 'sol' }, recipient, amount: SOL, openAccount: false },
			owner,
			BLOCKHASH
		);
		expect(() => assertTransferIntact(wireBytes, instructions, owner)).not.toThrow();

		const guard = {
			programAddress: LIGHTHOUSE_PROGRAM_ADDRESS,
			accounts: [],
			data: new Uint8Array([1])
		};
		const guarded = await signed(owner, [
			getSetComputeUnitLimitInstruction({ units: 1 }),
			...instructions,
			guard
		]);
		expect(() => assertTransferIntact(guarded, instructions, owner)).not.toThrow();

		const elsewhere = await signed(owner, [
			getTransferSolInstruction({
				source: createNoopSigner(owner),
				destination: await addr(),
				amount: SOL
			})
		]);
		expect(() => assertTransferIntact(elsewhere, instructions, owner)).toThrow(TransferRejected);
	});

	it('rejects a different fee payer', async () => {
		const { owner, recipient, feePayer } = await setup();
		const { instructions, wireBytes } = await buildTransferTransaction(
			{ owner, asset: { kind: 'sol' }, recipient, amount: SOL, openAccount: false },
			owner,
			BLOCKHASH
		);
		expect(() => assertTransferIntact(wireBytes, instructions, feePayer)).toThrow(/fee payer/);
	});
});
