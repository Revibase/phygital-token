import { address, createNoopSigner, getTransactionDecoder, getCompiledTransactionMessageDecoder, decompileTransactionMessage } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ sign: vi.fn(), simulate: vi.fn() }));
vi.mock('$lib/client/wallet/wallet.svelte', () => ({ canSignOnly: () => true, signWithWallet: mock.sign }));
vi.mock('phygital-token-sdk', async (original) => ({ ...await original<typeof import('phygital-token-sdk')>(), fetchSponsor: async () => null }));
vi.mock('$lib/client/rpc', () => ({ browserRpc: () => ({
	getBalance: () => ({ send: async () => ({ value: 100_000_000n }) }),
	getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n } }) }),
	simulateTransaction: (wire: string, options: unknown) => ({ send: () => mock.simulate(wire, options) })
}) }));
import { submitAsOwner, walletBalanceAfterInstructions } from '$lib/client/accessory-wallet/submit';
const OWNER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const RECIPIENT = address('So11111111111111111111111111111111111111112');
beforeEach(() => { vi.resetAllMocks(); });
describe('final NFT simulation before owner approval', () => {
	it('refuses when the exact final transaction fails simulation, before asking the wallet to sign', async () => {
		mock.simulate.mockResolvedValueOnce({ value: { err: null, unitsConsumed: 100_000n } }).mockResolvedValueOnce({ value: { err: 'RuleSetChanged', logs: ['NFT rules reject this transfer'] } });
		const build = vi.fn(async () => [getTransferSolInstruction({ source: createNoopSigner(OWNER), destination: RECIPIENT, amount: 1n })]);
		await expect(submitAsOwner({ address: OWNER } as never, { pda: RECIPIENT, simulateFinal: true, build })).rejects.toThrow(/NFT rules reject/);
		expect(mock.simulate).toHaveBeenCalledTimes(2);
		// Built once: the instructions measured as the owner are the ones signed.
		expect(build).toHaveBeenCalledTimes(1);
		expect(mock.sign).not.toHaveBeenCalled();
	});
	it('simulates the exact final transaction that is passed to the owner wallet', async () => {
		mock.simulate.mockResolvedValue({ value: { err: null, unitsConsumed: 100_000n } });
		mock.sign.mockResolvedValue({ kind: 'sent', signature: new Uint8Array(64) });
		await submitAsOwner({ address: OWNER } as never, { pda: RECIPIENT, simulateFinal: true, build: async () => [getTransferSolInstruction({ source: createNoopSigner(OWNER), destination: RECIPIENT, amount: 1n })] });
		expect(mock.simulate).toHaveBeenCalledTimes(2);
		expect(mock.simulate.mock.calls[1][0]).toBe(Buffer.from(mock.sign.mock.calls[0][1]).toString('base64'));
		expect(mock.simulate.mock.calls[1][1]).toMatchObject({ sigVerify: false });
		const tx = getTransactionDecoder().decode(mock.sign.mock.calls[0][1]);
		const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(tx.messageBytes));
		expect(message.version).toBe(1);
		if (message.version !== 1) throw new Error('Expected v1');
		expect(message.config).toMatchObject({ computeUnitLimit: 120_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024, priorityFeeLamports: 6_000n });
		expect(message.instructions).toHaveLength(1);
	});
});

describe('SOL balance after asset transfers', () => {
 it('uses the simulated post-transfer balance, including rent refunds and new account costs', async () => {
  mock.simulate.mockResolvedValue({ value: { err: null, unitsConsumed: 100_000n, accounts: [{ lamports: 102_039_280n }] } });
  const instructions = [getTransferSolInstruction({ source: createNoopSigner(OWNER), destination: RECIPIENT, amount: 1n })];
  expect(await walletBalanceAfterInstructions(OWNER, RECIPIENT, instructions)).toBe(102_039_280n);
  expect(mock.simulate.mock.calls[0][1]).toMatchObject({ accounts: { addresses: [RECIPIENT] }, sigVerify: false });
  expect(mock.sign).not.toHaveBeenCalled();
 });
 it('fails safely if simulation omits the post-transfer wallet balance', async () => {
  mock.simulate.mockResolvedValue({ value: { err: null, unitsConsumed: 100_000n } });
  await expect(walletBalanceAfterInstructions(OWNER, RECIPIENT, [getTransferSolInstruction({ source: createNoopSigner(OWNER), destination: RECIPIENT, amount: 1n })])).rejects.toThrow('determine the SOL balance');
  expect(mock.sign).not.toHaveBeenCalled();
 });
 it('reads the current balance directly for a SOL-only batch', async () => {
  expect(await walletBalanceAfterInstructions(OWNER, RECIPIENT, [])).toBe(100_000_000n);
  expect(mock.simulate).not.toHaveBeenCalled();
 });
});
