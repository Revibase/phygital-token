import { getWallets, type Wallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { UiWalletAccount } from '@wallet-standard/ui-core';
import { getOrCreateUiWalletAccountForStandardWalletAccount } from '@wallet-standard/ui-registry';
import { createTransactionSendingSignerFromWalletAccount } from '@solana/wallet-account-signer';
import type { TransactionSendingSigner } from '@solana/signers';
import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';

export type WalletState = {
	connected: boolean;
	connecting: boolean;
	wallet: Wallet | null;
	account: UiWalletAccount | null;
	signer: TransactionSendingSigner | null;
	error: string | null;
};

function emptyState(): WalletState {
	return {
		connected: false,
		connecting: false,
		wallet: null,
		account: null,
		signer: null,
		error: null
	};
}

export const walletStore = writable<WalletState>(emptyState());
export const availableWallets = writable<readonly Wallet[]>([]);

let walletsApi: Wallets | null = null;
let initialized = false;

function refreshAvailableWallets(): void {
	if (!walletsApi) {
		availableWallets.set([]);
		return;
	}

	const wallets = walletsApi.get().filter((wallet) => {
		if (isMobileWalletAdapterEnvironment()) {
			return true;
		}
		return !MWA_WALLET_NAMES.has(wallet.name);
	});
	availableWallets.set(wallets);
}

function getSolanaChain(): `solana:${string}` {
	return 'solana:devnet';
}

/** MWA web is supported on Android Chrome — not desktop browsers. */
export function isMobileWalletAdapterEnvironment(): boolean {
	if (!browser) {
		return false;
	}
	const ua = navigator.userAgent;
	const isAndroid = /android/i.test(ua);
	const isChrome = /chrome/i.test(ua) && !/edg/i.test(ua);
	return isAndroid && isChrome;
}

const MWA_WALLET_NAMES = new Set(['Mobile Wallet Adapter', 'Remote Mobile Wallet Adapter']);

function pickSolanaAccount(wallet: Wallet): UiWalletAccount | null {
	const account = wallet.accounts.find((entry) =>
		entry.chains.some((chain) => chain.startsWith('solana:'))
	);
	return account ? getOrCreateUiWalletAccountForStandardWalletAccount(wallet, account) : null;
}

function accountToSigner(account: UiWalletAccount): TransactionSendingSigner {
	return createTransactionSendingSignerFromWalletAccount(account, getSolanaChain());
}

export async function initWallet(): Promise<void> {
	if (!browser || initialized) {
		return;
	}

	if (isMobileWalletAdapterEnvironment()) {
		const {
			registerMwa,
			createDefaultAuthorizationCache,
			createDefaultChainSelector
		} = await import('@solana-mobile/wallet-standard-mobile');

		registerMwa({
			appIdentity: {
				name: 'Phygital NFTs',
				uri: window.location.origin,
				icon: `${window.location.origin}/favicon.svg`
			},
			authorizationCache: createDefaultAuthorizationCache(),
			chains: [getSolanaChain()],
			chainSelector: createDefaultChainSelector(),
			onWalletNotFound: async () => {
				throw new Error(
					'No compatible mobile wallet found. Install a Solana wallet that supports Mobile Wallet Adapter.'
				);
			}
		});
	}

	walletsApi = getWallets();
	walletsApi.on('register', refreshAvailableWallets);
	walletsApi.on('unregister', refreshAvailableWallets);
	refreshAvailableWallets();
	initialized = true;
}

export async function connectWallet(wallet: Wallet): Promise<void> {
	walletStore.update((state) => ({ ...state, connecting: true, error: null }));

	try {
		const solanaFeature = wallet.features['standard:connect'] as
			| { connect: (input?: { silent?: boolean }) => Promise<{ accounts: WalletAccount[] }> }
			| undefined;

		if (!solanaFeature) {
			throw new Error('Wallet does not support standard connect');
		}

		const { accounts } = await solanaFeature.connect();
		const connectedAccount =
			accounts.find((entry) => entry.chains.some((chain) => chain.startsWith('solana:'))) ??
			null;
		const account = connectedAccount
			? getOrCreateUiWalletAccountForStandardWalletAccount(wallet, connectedAccount)
			: pickSolanaAccount(wallet);

		if (!account) {
			throw new Error('No Solana account returned by wallet');
		}

		const signer = accountToSigner(account);
		walletStore.set({
			connected: true,
			connecting: false,
			wallet,
			account,
			signer,
			error: null
		});
	} catch (error) {
		walletStore.set({
			...emptyState(),
			connecting: false,
			error: error instanceof Error ? error.message : 'Failed to connect wallet'
		});
		throw error;
	}
}

export async function disconnectWallet(): Promise<void> {
	const wallet = get(walletStore).wallet;

	if (wallet?.features['standard:disconnect']) {
		const disconnect = wallet.features['standard:disconnect'] as {
			disconnect: () => Promise<void>;
		};
		await disconnect.disconnect();
	}
	walletStore.set(emptyState());
}
