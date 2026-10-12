import { getTransferSolInstruction } from '@solana-program/system';
import { address, createNoopSigner } from '@solana/kit';
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ balance: 1_200_000_000n, refill: 10_000_000n, send: vi.fn(), inner: vi.fn() }));
vi.mock('$lib/client/rpc', () => ({ rpcUrl: () => '', browserRpc: () => ({ getBalance: () => ({ send: async () => ({ value: mock.balance }) }), getMultipleAccounts: () => ({ send: async () => ({ value: [] }) }) }) }));
vi.mock('$lib/shared/wallet-instructions', async original => ({ ...await original<typeof import('$lib/shared/wallet-instructions')>(), buildSendInstructions: mock.send, buildSendInnerInstructions: mock.inner }));
vi.mock('$lib/client/accessory-wallet/submit', () => ({ walletBalanceAfterInstructions: async () => mock.balance, confirmAsOwner: async (ctx: { address: string }, action: { build: Function }) => { const owner = createNoopSigner(address(ctx.address)); await action.build(owner, owner, 0n); await action.build(owner, owner, mock.refill); return 'signature'; } }));
import { sendFromAccessoryWallet, sweepToOwner } from '$lib/client/accessory-wallet/send';
const OWNER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const PDA = address('So11111111111111111111111111111111111111112');
const ctx = { address: OWNER } as never;
beforeEach(() => { mock.balance = 1_200_000_000n; mock.refill = 10_000_000n; mock.send.mockReset().mockResolvedValue([]); mock.inner.mockReset().mockImplementation((input) => [getTransferSolInstruction({ source: createNoopSigner(PDA), destination: OWNER, amount: input.amount })]); });
it('rebuilds a Max SOL send with the exact fee refill deducted', async () => {
 await sendFromAccessoryWallet(ctx, { pda: PDA, asset: { kind: 'sol' }, recipient: OWNER, amount: 1_200_000_000n, sendAll: true });
 expect(mock.send.mock.calls.map(([input]) => input.amount)).toEqual([1_200_000_000n, 1_190_000_000n]);
});
it('keeps a fixed SOL amount unchanged when refilling', async () => {
 await sendFromAccessoryWallet(ctx, { pda: PDA, asset: { kind: 'sol' }, recipient: OWNER, amount: 500_000_000n });
 expect(mock.send.mock.calls.map(([input]) => input.amount)).toEqual([500_000_000n, 500_000_000n]);
});
it('uses the same refill deduction for the final SOL sweep', async () => {
 await sweepToOwner(ctx, PDA, { wallet: PDA, lamports: 1n, tokens: [] });
 expect(mock.inner.mock.calls.map(([input]) => input.amount).filter(amount => amount !== 1n)).toEqual([1_200_000_000n, 1_190_000_000n]);
});

it('leaves native SOL untouched when it is deselected', async () => {
 await sweepToOwner(ctx, PDA, { wallet: PDA, lamports: 1_200_000_000n, tokens: [] }, undefined, { sendSol: false });
 expect(mock.send).not.toHaveBeenCalled();
 expect(mock.inner).not.toHaveBeenCalled();
});
