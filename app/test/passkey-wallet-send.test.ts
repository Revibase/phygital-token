import {
	address,
	decompileTransactionMessage,
	getAddressDecoder,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	type Address
} from '@solana/kit';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WalletHoldings } from '$lib/shared/wallet-holdings';

const state = vi.hoisted(() => ({
	balance: 1_000_000_000n,
	/** What a simulation of the batch's asset transfers reads back for the wallet (after the simulated fee). */
	postBalance: 0n,
	units: 50_000,
	signed: [] as Uint8Array[],
	simulateError: null as Error | null
}));
vi.mock('$lib/client/rpc', () => ({
	rpcUrl: () => '',
	browserRpc: () => ({
		getLatestBlockhash: () => ({
			send: async () => ({
				value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0n }
			})
		}),
		// Every recipient token account already exists.
		getMultipleAccounts: (keys: unknown[]) => ({
			send: async () => ({ value: keys.map(() => ({ lamports: 1n })) })
		})
	})
}));
vi.mock('$lib/client/accessory-wallet/submit', async (importOriginal) => ({
	...(await importOriginal<object>()),
	lamportsOf: async () => state.balance,
	measure: async () => {
		if (state.simulateError) throw state.simulateError;
		return { units: state.units, rent: 0n };
	},
	walletBalanceAfterInstructions: async () => state.postBalance
}));
vi.mock('$lib/client/wallet/wallet.svelte', () => ({
	signWithWallet: async (_ctx: unknown, wire: Uint8Array) => {
		state.signed.push(wire);
		return { kind: 'sent', signature: new Uint8Array(64) };
	}
}));
vi.mock('$lib/client/tx', () => ({ waitForConfirmation: async () => {} }));
vi.mock('$lib/client/cache', () => ({
	queryClient: { invalidateQueries: async () => {} },
	queryKeys: { passkeyWallet: (w: string) => ['passkey-wallet', w] }
}));

import {
	MAX_NETWORK_FEE,
	sendAllFromPasskeyWallet,
	sendFromPasskeyWallet
} from '$lib/client/passkey-wallet/send';
import { computeLimit, feeFor } from '$lib/client/accessory-wallet/submit';
import { OwnerWalletNeedsSol } from '$lib/shared/fee-payer';

const wallet = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const recipient = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const key = (i: number) => getAddressDecoder().decode(new Uint8Array(32).fill(i));
const ctx = { address: wallet } as never;
const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = '11111111111111111111111111111111';

/** The fee the sent transaction pays, at the compute limit the mocked simulation measures. */
const fee = () => feeFor(1, computeLimit(state.units, false));

function signedMessage(i = 0) {
	const tx = getTransactionDecoder().decode(state.signed[i]);
	return decompileTransactionMessage(
		getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
	);
}
const lamportsSent = (data: ArrayLike<number>) =>
	new DataView(Uint8Array.from(data).buffer).getBigUint64(4, true);

const usdc = {
	mint: key(1),
	tokenAccount: key(101),
	tokenProgram: TOKEN,
	amount: 1_500_000n,
	decimals: 6,
	frozen: false,
	name: 'USD Coin',
	symbol: 'USDC',
	icon: null
};
const holdings = (lamports: bigint): WalletHoldings => ({
	wallet,
	lamports,
	tokens: [usdc],
	nfts: []
});

beforeEach(() => {
	state.balance = 1_000_000_000n;
	state.postBalance = 0n;
	state.signed = [];
	state.simulateError = null;
});

it('sends all SOL as a plain transfer the wallet pays for, leaving exactly its fee', async () => {
	await sendFromPasskeyWallet(ctx, {
		asset: { kind: 'sol' },
		recipient,
		amount: state.balance,
		sendAll: true
	});
	expect(state.signed).toHaveLength(1);
	const message = signedMessage();
	expect(message.feePayer.address).toBe(wallet);
	expect(message.instructions).toHaveLength(1);
	const [transfer] = message.instructions;
	expect(transfer.programAddress).toBe(SYSTEM);
	expect(transfer.accounts?.map((a) => a.address)).toEqual([wallet, recipient]);
	expect(lamportsSent(transfer.data!)).toBe(state.balance - fee());
});

it('sends a token straight from the wallet, with no accessory execute around it', async () => {
	await sendFromPasskeyWallet(ctx, {
		asset: { kind: 'token', token: usdc },
		recipient,
		amount: 500_000n
	});
	const [transfer] = signedMessage().instructions;
	expect(transfer.programAddress).toBe(TOKEN);
	expect(transfer.data![0]).toBe(12);
	// transferChecked: source, mint, destination, authority — the wallet itself signs.
	expect(transfer.accounts?.[3]?.address).toBe(wallet);
});

it('asks for SOL before anything is signed when the wallet can’t pay the fee', async () => {
	state.balance = MAX_NETWORK_FEE - 1n;
	await expect(
		sendFromPasskeyWallet(ctx, {
			asset: { kind: 'token', token: usdc },
			recipient,
			amount: 1n
		})
	).rejects.toBeInstanceOf(OwnerWalletNeedsSol);
	state.balance = 1_000_000_000n;
	state.simulateError = new Error('This would fail on the network: "InsufficientFundsForRent"');
	await expect(
		sendFromPasskeyWallet(ctx, { asset: { kind: 'sol' }, recipient, amount: 1n })
	).rejects.toBeInstanceOf(OwnerWalletNeedsSol);
	expect(state.signed).toHaveLength(0);
});

it('sends everything in one approval: token, its account closed back, then the SOL that leaves', async () => {
	// After the token account closes, the simulation (charged the full-limit fee) reads this back.
	state.postBalance = 1_002_039_280n - MAX_NETWORK_FEE;
	await sendAllFromPasskeyWallet(ctx, recipient, holdings(1_000_000_000n));
	expect(state.signed).toHaveLength(1);
	const message = signedMessage();
	expect(message.feePayer.address).toBe(wallet);
	const [transfer, close, sol] = message.instructions;
	expect([transfer.data![0], close.data![0]]).toEqual([12, 9]);
	expect(close.accounts?.[1]?.address).toBe(wallet);
	expect(sol.programAddress).toBe(SYSTEM);
	expect(lamportsSent(sol.data!)).toBe(1_002_039_280n - fee());
});

it('refuses to send to itself', async () => {
	await expect(
		sendAllFromPasskeyWallet(ctx, wallet as Address, holdings(1_000_000_000n))
	).rejects.toThrow('That’s this wallet itself.');
});
