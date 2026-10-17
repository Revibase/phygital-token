import { queryOptions } from '@tanstack/svelte-query';

import { fetchAccessoryMedia } from './media';
import { fetchAccessoryShortcuts } from './shortcuts';
import { fetchWalletAccessories } from './wallet-accessories';
import { queryKeys } from './cache';

// Persist NFT media only; shortcuts and wallet lists must follow current linkage.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export const accessoryMediaQuery = (pda: string) =>
	queryOptions({
		queryKey: queryKeys.media(pda),
		queryFn: () => fetchAccessoryMedia(pda),
		staleTime: (query) => (query.state.data?.image ? HOUR : 5 * MINUTE),
		gcTime: DAY,
		retry: 1
	});

/** The session decides which accessory the server reads; `pda` and `owner` only key the cache. */
export const accessoryShortcutsQuery = (pda: string, owner: string | null) =>
	queryOptions({
		queryKey: queryKeys.shortcuts(pda, owner),
		queryFn: fetchAccessoryShortcuts,
		staleTime: 10 * MINUTE,
		gcTime: HOUR,
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
