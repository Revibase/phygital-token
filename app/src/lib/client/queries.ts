import { QueryClient, queryOptions } from '@tanstack/svelte-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { browser } from '$app/environment';

import { fetchAccessoryMedia } from './media';
import { fetchAccessoryShortcuts } from './shortcuts';
import { fetchWalletAccessories } from './wallet-accessories';

// Persist NFT media only; shortcuts and wallet lists must follow current linkage.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export const queryKeys = {
	media: (pda: string) => ['accessory-media', pda] as const,
	shortcuts: (pda: string, owner: string | null) => ['accessory-shortcuts', pda, owner ?? ''] as const,
	walletAccessories: (wallet: string) => ['wallet-accessories', wallet] as const
};

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

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { enabled: browser, refetchOnWindowFocus: true }
		}
	});
}

/** The app's single client cache. Empty on the server: nothing fetches during SSR. */
export const queryClient = createQueryClient();

export function forgetWalletAccessories() {
	queryClient.removeQueries({ queryKey: ['wallet-accessories'] });
}

/** Bump when a cached shape changes, so old persisted entries are discarded. */
const CACHE_BUSTER = 'v1';

export const persistOptions = {
	persister: createSyncStoragePersister({
		// localStorage can throw or be missing (private windows, blocked storage): the cache just stays in memory then.
		storage: (() => {
			try {
				return browser ? window.localStorage : undefined;
			} catch {
				return undefined;
			}
		})(),
		key: 'revibase-query-cache',
		throttleTime: 1000
	}),
	maxAge: DAY,
	buster: CACHE_BUSTER,
	dehydrateOptions: {
		shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
			query.state.status === 'success' && query.queryKey[0] === 'accessory-media'
	}
};
