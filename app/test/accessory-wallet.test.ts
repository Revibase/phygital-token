import {
	address,
	AccountRole,
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	getTransactionEncoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Blockhash,
	type Instruction
} from '@solana/kit';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferSolInstruction } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
	buildExecuteWithOwnerInstruction,
	findWalletPda,
	getExecuteWithOwnerInstructionDataDecoder,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS
} from 'phygital-token-sdk';
import { describe, expect, it, vi } from 'vitest';

import { formatCompactTokenAmount, formatTokenAmount, sanitizeDecimalInput, uiAmountToRaw } from '$lib/shared/amount';
import { describeHoldings, isCollectible, transferRestriction, fetchWalletHoldings, parseTokenAccounts, TOKEN_2022_PROGRAM_ADDRESS, type TokenHolding } from '$lib/shared/wallet-holdings';
import { solSendAmount, buildSendInstructions, buildSweepTokenInner, sweepTokenOrder } from '$lib/shared/wallet-instructions';
import { assertTransactionIntact } from '$lib/shared/wallet-transaction';

const PDA = address('7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN');
const OWNER = address('Ce4vZ9YiTnqBSHqZHs6s3gNa1LANHNFrSrCq3QFamV8J');
const OTHER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_ACCOUNT = address('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T');
const owner = createNoopSigner(OWNER);

const usdc = (amount: bigint, extra: Partial<TokenHolding> = {}): TokenHolding => ({
	tokenAccount: TOKEN_ACCOUNT,
	mint: MINT,
	tokenProgram: TOKEN_PROGRAM_ADDRESS,
	amount,
	decimals: 6,
	frozen: false,
	name: 'USD Coin',
	symbol: 'USDC',
	icon: null,
	...extra
});

describe('amount helpers', () => {
	it('round-trips without floats', () => {
		expect(uiAmountToRaw('1.5', 9)).toBe(1_500_000_000n);
		expect(uiAmountToRaw('.000001', 6)).toBe(1n);
		expect(formatTokenAmount(1_500_000_000n, 9)).toBe('1.5');
		expect(formatTokenAmount(0n, 6)).toBe('0');
	});
	it('rejects empty, zero, malformed and over-precise input', () => {
		for (const bad of ['', '0', '0.0', '.', '1.2.3', 'abc']) expect(() => uiAmountToRaw(bad, 6)).toThrow();
		expect(() => uiAmountToRaw('0.0000001', 6)).toThrow(/at most 6 decimals/);
	});
	it('sanitizes typing and formats compactly', () => {
		expect(sanitizeDecimalInput('1,2a.3')).toBe('1.23');
		expect(formatCompactTokenAmount(1_234_567_890_000n, 9)).toBe('1,234.56');
		expect(formatCompactTokenAmount(1_234_567_890n, 9)).toBe('1.2345');
		expect(formatCompactTokenAmount(1n, 9)).toBe('<0.000001');
	});
});

describe('wallet holdings', () => {
	const parsed = (mint: string, amount: string, state = 'initialized') => ({
		pubkey: TOKEN_ACCOUNT,
		account: { data: { parsed: { info: { mint, state, tokenAmount: { amount, decimals: 6 } } } } }
	});

	it('drops empty accounts and flags frozen ones', () => {
		const tokens = parseTokenAccounts([parsed(MINT, '0'), parsed(MINT, '25', 'frozen')], TOKEN_PROGRAM_ADDRESS);
		expect(tokens).toEqual([expect.objectContaining({ mint: MINT, amount: 25n, decimals: 6, frozen: true, tokenProgram: TOKEN_PROGRAM_ADDRESS })]);
	});

	it('recognizes NFTs from their standard, not zero decimals alone', () => {
		expect(isCollectible(usdc(1n, { decimals: 0 }))).toBe(false);
		expect(isCollectible(usdc(1n, { decimals: 0, tokenStandard: 'NonFungible' }))).toBe(true);
		expect(isCollectible(usdc(2n, { decimals: 0, tokenStandard: 'NonFungible' }))).toBe(false);
		expect(transferRestriction(usdc(1n, { decimals: 0, frozen: true, tokenStandard: 'ProgrammableNonFungible' }))).toBeNull();
	});

	it('retains NFT standards and artwork from DAS alongside on-chain balances', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { items: [{ id: MINT, interface: 'V1_NFT', content: { metadata: { name: 'Collectible', token_standard: 'NonFungible' }, links: { image: 'https://example.com/nft.png' } } }] } })));
		try {
			const nftAccount = parsed(MINT, '1');
			nftAccount.account.data.parsed.info.tokenAmount.decimals = 0;
			const rpc = { getBalance: () => ({ send: async () => ({ value: 7n }) }), getTokenAccountsByOwner: (_: unknown, filter: { programId: string }) => ({ send: async () => ({ value: filter.programId === TOKEN_PROGRAM_ADDRESS ? [nftAccount] : [] }) }) };
			const holdings = await fetchWalletHoldings(rpc as never, OTHER, 'https://example.com/rpc');
			expect(holdings.tokens[0]).toMatchObject({ amount: 1n, name: 'Collectible', icon: 'https://example.com/nft.png', tokenStandard: 'NonFungible' });
			expect(isCollectible(holdings.tokens[0])).toBe(true);
		} finally { fetchMock.mockRestore(); }
	});

	it('reads SOL and both token programs from RPC', async () => {
		const programs: string[] = [];
		const rpc = {
			getBalance: () => ({ send: async () => ({ value: 7n }) }),
			getTokenAccountsByOwner: (_: unknown, filter: { programId: string }) => {
				programs.push(filter.programId);
				return { send: async () => ({ value: filter.programId === TOKEN_PROGRAM_ADDRESS ? [parsed(MINT, '5')] : [] }) };
			}
		};
		const holdings = await fetchWalletHoldings(rpc as never, OTHER, null);
		expect(programs.sort()).toEqual([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS].sort());
		expect(holdings).toMatchObject({ wallet: OTHER, lamports: 7n, tokens: [{ mint: MINT, amount: 5n }] });
		expect(describeHoldings(holdings)).toBe('<0.000001 SOL and 1 token');
		expect(describeHoldings({ wallet: OTHER, lamports: 0n, tokens: [] })).toBeNull();
	});
});

describe('send instructions', () => {
	it('SOL: one execute_with_owner moving lamports out of the wallet PDA', async () => {
		const [wallet] = await findWalletPda({ phygitalToken: PDA });
		const [execute, ...rest] = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'sol' }, recipient: OTHER, amount: 5n });
		expect(rest).toHaveLength(0);
		expect(execute.programAddress).toBe(PHYGITAL_TOKEN_PROGRAM_ADDRESS);
		expect(execute.accounts?.slice(0, 3).map((a) => a.address)).toEqual([OWNER, PDA, wallet]);
		const { compactInstructions } = getExecuteWithOwnerInstructionDataDecoder().decode(execute.data!);
		const remaining = execute.accounts!.slice(4);
		const [inner] = compactInstructions;
		expect(remaining[inner.programIdIndex].address).toBe('11111111111111111111111111111111');
		const metas = [...inner.accountIndexes].map((i) => remaining[i]);
		expect(metas.map((m) => m.address)).toEqual([wallet, OTHER]);
		expect(metas[0].role).toBe(AccountRole.WRITABLE);
	});

	it('token: transferChecked with the wallet as authority, opening the recipient account only when asked', async () => {
		const [wallet] = await findWalletPda({ phygitalToken: PDA });
		const [execute, ...rest] = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'token', token: usdc(10n) }, recipient: OTHER, amount: 3n });
		expect(rest).toHaveLength(0);
		const { compactInstructions } = getExecuteWithOwnerInstructionDataDecoder().decode(execute.data!);
		const remaining = execute.accounts!.slice(4);
		expect(compactInstructions).toHaveLength(1);
		const [inner] = compactInstructions;
		expect(remaining[inner.programIdIndex].address).toBe(TOKEN_PROGRAM_ADDRESS);
		expect(inner.data[0]).toBe(12);
		const authority = remaining[inner.accountIndexes[3]];
		expect(authority).toEqual({ address: wallet, role: AccountRole.READONLY });
	});

	it('token to a new recipient: the accessory wallet pays for its account, inside the execute', async () => {
		const [wallet] = await findWalletPda({ phygitalToken: PDA });
		const [execute] = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'token', token: usdc(10n) }, recipient: OTHER, amount: 3n, openAccount: true });
		const { compactInstructions } = getExecuteWithOwnerInstructionDataDecoder().decode(execute.data!);
		const remaining = execute.accounts!.slice(4);
		const [open, transfer] = compactInstructions;
		expect(remaining[open.programIdIndex].address).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
		expect(remaining[open.accountIndexes[0]].address).toBe(wallet);
		expect(transfer.data[0]).toBe(12);
	});

	it('sends a standard NFT as one indivisible token and refuses unsupported transfers', async () => {
		const nft = usdc(1n, { decimals: 0, tokenStandard: 'NonFungible' });
		const [execute] = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'token', token: nft }, recipient: OTHER, amount: 1n, openAccount: true });
		const { compactInstructions } = getExecuteWithOwnerInstructionDataDecoder().decode(execute.data!);
		const transfer = compactInstructions[1];
		expect([...transfer.data]).toEqual([12, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
		await expect(buildSendInstructions({ owner, pda: PDA, asset: { kind: 'token', token: nft }, recipient: OTHER, amount: 2n })).rejects.toThrow(/exactly one/);
		await expect(buildSendInstructions({ owner, pda: PDA, asset: { kind: 'token', token: { ...nft, tokenStandard: 'ProgrammableNonFungible' } }, recipient: OTHER, amount: 1n })).rejects.toThrow(/RPC is required/);
		expect(sweepTokenOrder({ wallet: OTHER, lamports: 0n, tokens: [nft, { ...nft, frozen: true }, { ...nft, tokenStandard: 'ProgrammableNonFungible' }] })).toEqual([nft]);
	});

	it('rejects sending to the accessory wallet itself', async () => {
		const [wallet] = await findWalletPda({ phygitalToken: PDA });
		await expect(buildSendInstructions({ owner, pda: PDA, asset: { kind: 'sol' }, recipient: wallet, amount: 1n })).rejects.toThrow();
	});

	it('sweep: tokens in batches (existing owner accounts first), closing back into the wallet, frozen skipped', async () => {
		const [wallet] = await findWalletPda({ phygitalToken: PDA });
		const newMint = address('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
		const tokens = [usdc(1n, { mint: newMint }), ...Array.from({ length: 4 }, () => usdc(1n)), usdc(1n, { frozen: true })];
		const ordered = sweepTokenOrder({ wallet, lamports: 9n, tokens }, new Set([newMint]));
		expect(ordered).toHaveLength(5);
		expect(ordered[4].mint).toBe(newMint);
		// As the sweep sends them: each batch's transfers wrapped in one owner execute.
		const batch = async (...args: Parameters<typeof buildSweepTokenInner>) => buildExecuteWithOwnerInstruction({ owner, phygitalToken: PDA, instructions: await buildSweepTokenInner(...args) });
		const first = await batch(owner, PDA, wallet, ordered.slice(0, 4));
		const { compactInstructions } = getExecuteWithOwnerInstructionDataDecoder().decode(first.data!);
		expect(compactInstructions.map((ix) => ix.data[0])).toEqual([12, 9, 12, 9, 12, 9, 12, 9]);
		const remaining = first.accounts!.slice(4);
		expect(remaining[compactInstructions[1].accountIndexes[1]].address).toBe(wallet);
		const opening = await batch(owner, PDA, wallet, ordered.slice(4), new Set([newMint]));
		expect(getExecuteWithOwnerInstructionDataDecoder().decode(opening.data!).compactInstructions).toHaveLength(3);
	});
});

describe('assertTransactionIntact', () => {
	const blockhash = { blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM' as Blockhash, lastValidBlockHeight: 1n };
	const wire = (feePayer: string, instructions: Instruction[]) =>
		new Uint8Array(
			getTransactionEncoder().encode(
				compileTransaction(
					pipe(
						createTransactionMessage({ version: 0 }),
						(m) => setTransactionMessageFeePayer(address(feePayer), m),
						(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
						(m) => appendTransactionMessageInstructions(instructions, m)
					)
				)
			)
		);
	const budget = getSetComputeUnitPriceInstruction({ microLamports: 1n });

	it('accepts our instructions plus wallet-added compute budget', async () => {
		const ixs = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'sol' }, recipient: OTHER, amount: 5n });
		expect(() => assertTransactionIntact(wire(OWNER, [budget, ...ixs, budget]), ixs, OWNER)).not.toThrow();
	});

	it('rejects a different fee payer, an altered execute or an extra signer', async () => {
		const ixs = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'sol' }, recipient: OTHER, amount: 5n });
		const altered = await buildSendInstructions({ owner, pda: PDA, asset: { kind: 'sol' }, recipient: OTHER, amount: 6n });
		const extra = getTransferSolInstruction({ source: createNoopSigner(OTHER), destination: OWNER, amount: 1n });
		expect(() => assertTransactionIntact(wire(OTHER, ixs), ixs, OWNER)).toThrow(/fee payer/);
		expect(() => assertTransactionIntact(wire(OTHER, ixs), ixs, OWNER, OTHER)).not.toThrow();
		expect(() => assertTransactionIntact(wire(OWNER, altered), ixs, OWNER)).toThrow();
		expect(() => assertTransactionIntact(wire(OWNER, [...ixs, extra]), ixs, OWNER)).toThrow();
	});
});


describe('SOL sends with a network-fee refill', () => {
	it('subtracts only the required refill when sending all, including a refreshed balance', () => {
		expect(solSendAmount(1_200_000_000n, 1_200_000_000n, 10_000_000n, true)).toBe(1_190_000_000n);
		expect(solSendAmount(1_100_000_000n, 1_200_000_000n, 10_000_000n, true)).toBe(1_090_000_000n);
		expect(solSendAmount(1_200_000_000n, 1_200_000_000n, 0n, true)).toBe(1_200_000_000n);
	});
	it('preserves a fixed send amount while reserving the refill', () => {
		expect(solSendAmount(1_200_000_000n, 500_000_000n, 10_000_000n)).toBe(500_000_000n);
		expect(() => solSendAmount(1_200_000_000n, 1_195_000_000n, 10_000_000n)).toThrow(/top-up/);
	});
	it('rejects fee-only balances and residual balances below rent exemption', () => {
		expect(() => solSendAmount(10_000_000n, 10_000_000n, 10_000_000n, true)).toThrow(/top-up/);
		expect(() => solSendAmount(1_200_000_000n, 1_189_999_999n, 10_000_000n)).toThrow(/top-up/);
	});
});
