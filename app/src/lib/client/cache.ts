import { QueryClient } from '@tanstack/react-query';

/** The app's query cache: its keys, the client, and what a link or release makes stale. Nothing is persisted. */
const browser = typeof window !== 'undefined';

export const queryKeys = {
	walletAccessories: (wallet: string) => ['wallet-accessories', wallet] as const,
	walletHoldings: (wallet: string) => ['wallet-holdings', wallet] as const
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
