import { address, createNoopSigner, getAddressDecoder, type Address } from '@solana/kit';
import { getExecuteWithOwnerInstructionDataDecoder } from 'phygital-token-sdk';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WalletHoldings } from '$lib/shared/wallet-holdings';
import { TransactionComputeLimitError } from '$lib/shared/transaction-v1-size';

const state = vi.hoisted(() => ({ approvals: vi.fn(), computeSplit: false, postBalance: 1_212_235_680n }));
vi.mock('$lib/client/rpc', () => ({ rpcUrl: () => '', browserRpc: () => ({ getBalance: () => ({ send: async () => ({ value: 1_200_000_000n }) }), getMultipleAccounts: (keys: unknown[]) => ({ send: async () => ({ value: keys.map(() => ({ lamports: 1n })) }) }) }) }));
vi.mock('$lib/shared/nft-transfers', () => ({ buildCoreTransfer: async (_rpc: unknown, wallet: Address, nft: { id: Address }) => [{ programAddress: address('11111111111111111111111111111111'), accounts: [{ address: wallet, role: 1 }, { address: nft.id, role: 1 }], data: new Uint8Array(20) }] }));
vi.mock('$lib/client/accessory-wallet/submit', () => ({ walletBalanceAfterInstructions: async () => state.postBalance, confirmAsOwner: async (ctx: { address: string }, action: { build: Function }) => {
	const owner = createNoopSigner(address(ctx.address));
	const instructions = await action.build(owner, owner, 0n);
	if (state.computeSplit && getExecuteWithOwnerInstructionDataDecoder().decode(instructions[0].data).compactInstructions.length > 7) throw new TransactionComputeLimitError('compute limit');
	state.approvals(instructions);
	return 'signature';
} }));
import { estimateSweepApprovals, sweepToOwner } from '$lib/client/accessory-wallet/send';

const owner = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const pda = address('So11111111111111111111111111111111111111112');
const key = (i: number) => getAddressDecoder().decode(new Uint8Array(32).fill(i));
const holdings: WalletHoldings = { wallet: key(250), lamports: 1_200_000_000n, tokens: Array.from({ length: 6 }, (_, i) => ({ mint: key(i + 1), tokenAccount: key(i + 101), tokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), amount: 1n, decimals: 0, frozen: false, name: null, symbol: null, icon: null })), nfts: [{ id: key(200), kind: 'core', name: null, icon: null, frozen: false }] };
beforeEach(() => { state.approvals.mockReset(); state.computeSplit = false; });

it('estimates the same mixed-asset size batches that are sent, with SOL as the final instruction', async () => {
	expect(await estimateSweepApprovals(owner, pda, holdings)).toBe(1);
	await sweepToOwner({ address: owner } as never, pda, holdings);
	expect(state.approvals).toHaveBeenCalledTimes(1);
	const execute = state.approvals.mock.calls[0][0][0];
	expect(getExecuteWithOwnerInstructionDataDecoder().decode(execute.data).compactInstructions).toHaveLength(14);
	const final = getExecuteWithOwnerInstructionDataDecoder().decode(execute.data).compactInstructions.at(-1)!;
	expect(new DataView(final.data.buffer, final.data.byteOffset).getUint32(0, true)).toBe(2);
	expect(new DataView(final.data.buffer, final.data.byteOffset).getBigUint64(4, true)).toBe(state.postBalance);
});

it('deselection removes transfers from both the estimate and execution', async () => {
	const selected = { ...holdings, tokens: holdings.tokens.slice(0, 1), nfts: [] };
	expect(await estimateSweepApprovals(owner, pda, selected, false)).toBe(1);
	await sweepToOwner({ address: owner } as never, pda, selected, undefined, { sendSol: false });
	expect(state.approvals).toHaveBeenCalledTimes(1);
});

it('splits compute-heavy batches before approval and updates progress', async () => {
	state.computeSplit = true;
	const progress = vi.fn();
	await sweepToOwner({ address: owner } as never, pda, holdings, progress);
	expect(state.approvals).toHaveBeenCalledTimes(3);
	expect(progress).toHaveBeenLastCalledWith(3, 3);
});

it('sends USDC and SOL with one approval, including refunded rent', async () => {
 const selected = { ...holdings, tokens: holdings.tokens.slice(0, 1), nfts: [] };
 expect(await estimateSweepApprovals(owner, pda, selected)).toBe(1);
 await sweepToOwner({ address: owner } as never, pda, selected);
 expect(state.approvals).toHaveBeenCalledTimes(1);
 const instructions = getExecuteWithOwnerInstructionDataDecoder().decode(state.approvals.mock.calls[0][0][0].data).compactInstructions;
 expect(instructions.map(ix => ix.data[0])).toEqual([12, 9, 2]);
 expect(new DataView(instructions[2].data.buffer, instructions[2].data.byteOffset).getBigUint64(4, true)).toBe(state.postBalance);
});
