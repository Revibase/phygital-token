import { QueryClient } from '@tanstack/svelte-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { browser } from '$app/env';

/** The app's query cache: its keys, the client, what persists, and what a link or release makes stale. */
const DAY = 24 * 60 * 60 * 1000;

export const queryKeys = {
	media: (pda: string) => ['accessory-media', pda] as const,
	shortcuts: (pda: string, owner: string | null) =>
		['accessory-shortcuts', pda, owner ?? ''] as const,
	walletAccessories: (wallet: string) => ['wallet-accessories', wallet] as const,
	walletHoldings: (wallet: string) => ['wallet-holdings', wallet] as const,
	walletSetup: (wallet: string) => ['wallet-setup', wallet] as const
};

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { enabled: browser, refetchOnWindowFocus: true }
		}
	});
}

/** The app's single client cache. Empty on the server: nothing fetches during SSR. */
export const queryClient = createQueryClient();

/** After a link or release: which accessories each wallet owns has changed. Dropped, not refetched, so no stale list flashes. */
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
