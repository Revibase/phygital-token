import { address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { fetchOwnerAssets } from '$lib/shared/nft-assets';
import {
	fetchWalletHoldings,
	portfolioValue,
	usdPrice,
	type WalletHoldings
} from '$lib/shared/wallet-holdings';
const wallet = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const mint = address('So11111111111111111111111111111111111111112');
const tokenProgram = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const token = {
	tokenAccount: wallet,
	mint,
	tokenProgram,
	amount: 2_500_000n,
	decimals: 6,
	frozen: false,
	name: 'Token',
	symbol: 'T',
	icon: null,
	priceUsd: 2
};
describe('DAS wallet valuation', () => {
	it('sums native SOL and separate token accounts without duplicating mint total_price', () => {
		const holdings: WalletHoldings = {
			wallet,
			lamports: 1_000_000_000n,
			solPriceUsd: 100,
			tokens: [token, { ...token, tokenAccount: mint, amount: 1_000_000n }],
			nfts: [{ id: wallet, kind: 'core', name: null, icon: null, frozen: false }],
			nftStatus: 'complete'
		};
		expect(portfolioValue(holdings)).toEqual({ usd: 107, unpriced: 1, partial: false });
	});
	it('does not present missing, invalid or non-dollar prices as zero', () => {
		expect(usdPrice({ currency: 'SOL', price_per_token: 2 })).toBeNull();
		expect(usdPrice({ currency: 'USD', price_per_token: NaN })).toBeNull();
		expect(usdPrice({ currency: 'USDC', price_per_token: 1 })).toBe(1);
		expect(portfolioValue({ wallet, lamports: 1n, tokens: [], nftStatus: 'complete' })).toEqual({
			usd: null,
			unpriced: 1,
			partial: false
		});
		expect(portfolioValue({ wallet, lamports: 0n, tokens: [], nftStatus: 'complete' }).usd).toBe(0);
		expect(
			portfolioValue({ wallet, lamports: 0n, tokens: [], nftStatus: 'unavailable' }).usd
		).toBeNull();
	});
	it('paginates despite page-local total, deduplicates assets, and captures native price only once', async () => {
		const asset = { id: mint, interface: 'FungibleToken' };
		const mock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						result: {
							items: Array(200).fill(asset),
							total: 200,
							nativeBalance: { price_per_sol: 100 }
						}
					})
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ result: { items: [asset], nativeBalance: { price_per_sol: 200 } } })
				)
			);
		try {
			const result = await fetchOwnerAssets('https://example.test', wallet);
			expect(result).toMatchObject({
				status: 'complete',
				assets: [asset],
				nativeBalance: { price_per_sol: 100 }
			});
			expect(mock).toHaveBeenCalledTimes(2);
			const request = JSON.parse(String(mock.mock.calls[0][1]?.body));
			expect(request.method).toBe('getAssetsByOwner');
			expect(request.params.displayOptions).toMatchObject({
				showFungible: true,
				showNativeBalance: true
			});
		} finally {
			mock.mockRestore();
		}
	});
	it('joins DAS prices to exact balances including a non-associated token account', async () => {
		const raw = '9007199254740993';
		const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					result: {
						items: [
							{
								id: mint,
								interface: 'FungibleToken',
								token_info: {
									symbol: 'T',
									associated_token_address: mint,
									price_info: { currency: 'USD', price_per_token: 2, total_price: 999999 }
								}
							}
						],
						nativeBalance: { price_per_sol: 100 }
					}
				})
			)
		);
		const rpc = {
			getBalance: () => ({ send: async () => ({ value: 1_000_000_000n }) }),
			getTokenAccountsByOwner: (_: unknown, filter: { programId: string }) => ({
				send: async () => ({
					value:
						filter.programId === tokenProgram
							? [
									{
										pubkey: wallet,
										account: {
											data: {
												parsed: {
													info: {
														mint,
														state: 'initialized',
														tokenAmount: { amount: raw, decimals: 6 }
													}
												}
											}
										}
									}
								]
							: []
				})
			})
		};
		try {
			const holdings = await fetchWalletHoldings(rpc as never, wallet, 'https://example.test');
			expect(holdings.tokens[0]).toMatchObject({
				tokenAccount: wallet,
				amount: BigInt(raw),
				priceUsd: 2
			});
			expect(holdings.solPriceUsd).toBe(100);
			expect(mock).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(mock.mock.calls[0][1]?.body)).method).toBe('getAssetsByOwner');
		} finally {
			mock.mockRestore();
		}
	});
});
