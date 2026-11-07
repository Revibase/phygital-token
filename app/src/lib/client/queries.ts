import { queryOptions } from '@tanstack/react-query';

import { proxied, proxiedImages } from './asset-image';
import { fetchWalletAccessories } from './wallet-accessories';
import { browserRpc, rpcUrl } from './rpc';
import { address } from '@solana/kit';
import { fetchWalletHoldings } from '#lib/shared/wallet-holdings.ts';
import { queryKeys } from './cache';

const MINUTE = 60 * 1000;

/** SOL and fungible tokens. */
export const walletHoldingsQuery = (wallet: string) =>
	queryOptions({
		queryKey: queryKeys.walletHoldings(wallet),
		queryFn: async () => {
			const holdings = await fetchWalletHoldings(browserRpc(), rpcUrl(), address(wallet));
			const images = await proxiedImages(holdings.tokens.map((token) => token.icon));
			return {
				...holdings,
				tokens: holdings.tokens.map((token) => ({ ...token, icon: proxied(token.icon, images) }))
			};
		},
		staleTime: 15_000,
		gcTime: 5 * MINUTE,
		retry: 1
	});

export const walletAccessoriesQuery = (wallet: string) =>
	queryOptions({
		queryKey: queryKeys.walletAccessories(wallet),
		queryFn: () => fetchWalletAccessories(wallet),
		staleTime: 0,
		gcTime: 5 * MINUTE,
		retry: 1
	});
