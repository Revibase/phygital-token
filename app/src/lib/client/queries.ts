import { queryOptions } from '@tanstack/svelte-query';

import { fetchAccessoryWallet } from './accessory-wallet/holdings';
import { fetchAccessoryPolicy } from './accessory-wallet/policy';
import { fetchAccessoryMedia } from './media';
import { fetchAccessoryShortcuts } from './shortcuts';
import { fetchWalletAccessories } from './wallet-accessories';
import { previewFee } from './accessory-wallet/submit';
import { fetchPasskeyWallet } from './passkey-wallet/send';
import { walletStore } from './wallet/wallet.svelte';
import { queryKeys } from './cache';

export { queryKeys };

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

export const accessoryWalletQuery = (pda: string) =>
	queryOptions({
		queryKey: queryKeys.accessoryWallet(pda),
		queryFn: () => fetchAccessoryWallet(pda),
		staleTime: 15 * 1000,
		gcTime: 5 * MINUTE,
		retry: 1
	});

/** The passkey wallet's own balances: what's in the connected Revibase Passkey wallet itself. */
export const passkeyWalletQuery = (wallet: string) =>
	queryOptions({
		queryKey: queryKeys.passkeyWallet(wallet),
		queryFn: () => fetchPasskeyWallet(wallet),
		staleTime: 15 * 1000,
		gcTime: 5 * MINUTE,
		retry: 1
	});

export const accessoryPolicyQuery = (pda: string) =>
	queryOptions({
		queryKey: queryKeys.accessoryPolicy(pda),
		queryFn: () => fetchAccessoryPolicy(pda),
		staleTime: 15 * 1000,
		gcTime: 5 * MINUTE,
		retry: 1
	});

/** Who pays this accessory's next network fee, for the connected wallet. */
export const feePreviewQuery = (pda: string, owner: string | null, drainsWallet = false) =>
	queryOptions({
		queryKey: queryKeys.feePreview(pda, owner, drainsWallet),
		queryFn: () => previewFee(walletStore.signingContext(), pda, 0n, drainsWallet),
		enabled: !!owner,
		staleTime: 15 * 1000
	});
