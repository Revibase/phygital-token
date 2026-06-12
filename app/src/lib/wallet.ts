import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { UiWalletAccount } from '@wallet-standard/ui-core';
import { getOrCreateUiWalletAccountForStandardWalletAccount } from '@wallet-standard/ui-registry';
import {
	ConnectorClient,
	getDefaultConfig,
	isConnected,
	ready,
	type WalletConnectConfig,
	type WalletConnectorId,
	type WalletConnectorMetadata
} from '@solana/connector/headless';
import {
	SolanaSignMessage,
	type SolanaSignMessageFeature
} from '@solana/wallet-standard-features';
import {
	SolanaSignTransaction,
	type SolanaSignTransactionFeature
} from '@solana/wallet-standard-features';
import { createTransactionSendingSignerFromWalletAccount } from '@solana/wallet-account-signer';
import type { TransactionSendingSigner } from '@solana/signers';
import type { SolanaWalletAdapter } from '@ardrive/turbo-sdk/web';
import { Transaction } from '@solana/web3.js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { get, writable } from 'svelte/store';
import { getRpcUrl } from './rpc';

export type WalletConnectorOption = WalletConnectorMetadata;

export type WalletState = {
	connected: boolean;
	connecting: boolean;
	accountAddress: string | null;
	signer: TransactionSendingSigner | null;
	connectorId: string | null;
	error: string | null;
};

function emptyState(): WalletState {
	return {
		connected: false,
		connecting: false,
		accountAddress: null,
		signer: null,
		connectorId: null,
		error: null
	};
}

export const walletStore = writable<WalletState>(emptyState());
export const availableConnectors = writable<readonly WalletConnectorOption[]>([]);
export const walletConnectUri = writable<string | null>(null);
export const walletReady = writable(false);

let connectorClient: ConnectorClient | null = null;
let connectorUnsubscribe: (() => void) | null = null;
let connectedWallet: Wallet | null = null;
let connectedAccount: WalletAccount | null = null;
let initialized = false;
let connectAttempt = 0;

const CONNECT_TIMEOUT_MS = 120_000;
const CONNECTOR_INIT_TIMEOUT_MS = 15_000;

const FEATURED_WALLET_NAMES = ['Phantom', 'Solflare'];

export function getNetworkFromRpc(): 'devnet' | 'mainnet' | 'testnet' {
	const url = getRpcUrl().toLowerCase();
	if (url.includes('devnet')) {
		return 'devnet';
	}
	if (url.includes('testnet')) {
		return 'testnet';
	}
	return 'mainnet';
}

export function getSolanaChain(): `solana:${string}` {
	const network = getNetworkFromRpc();
	if (network === 'devnet') {
		return 'solana:devnet';
	}
	if (network === 'testnet') {
		return 'solana:testnet';
	}
	return 'solana:mainnet';
}

function accountToSigner(
	wallet: Wallet,
	account: WalletAccount
): { uiAccount: UiWalletAccount; signer: TransactionSendingSigner } {
	const uiAccount = getOrCreateUiWalletAccountForStandardWalletAccount(wallet, account);
	const signer = createTransactionSendingSignerFromWalletAccount(uiAccount, getSolanaChain());
	return { uiAccount, signer };
}

export function isWalletConnectConnector(
	connector: Pick<WalletConnectorMetadata, 'id' | 'name'>
): boolean {
	const id = String(connector.id).toLowerCase();
	const name = connector.name.toLowerCase();
	return id.includes('walletconnect') || name.includes('walletconnect');
}

function sortConnectors(connectors: readonly WalletConnectorOption[]): WalletConnectorOption[] {
	return [...connectors].sort((left, right) => {
		const leftWalletConnect = isWalletConnectConnector(left);
		const rightWalletConnect = isWalletConnectConnector(right);
		if (leftWalletConnect !== rightWalletConnect) {
			return leftWalletConnect ? 1 : -1;
		}

		const leftFeatured = FEATURED_WALLET_NAMES.includes(left.name);
		const rightFeatured = FEATURED_WALLET_NAMES.includes(right.name);
		if (leftFeatured !== rightFeatured) {
			return leftFeatured ? -1 : 1;
		}

		return left.name.localeCompare(right.name);
	});
}

function refreshAvailableConnectors(): void {
	if (!connectorClient) {
		availableConnectors.set([]);
		return;
	}

	availableConnectors.set(sortConnectors(connectorClient.getSnapshot().connectors));
}

function syncWalletState(): void {
	if (!connectorClient) {
		return;
	}

	const state = connectorClient.getSnapshot();
	refreshAvailableConnectors();

	const wallet = state.wallet;
	if (!isConnected(wallet)) {
		connectedWallet = null;
		connectedAccount = null;
		if (wallet.status === 'connecting') {
			walletStore.update(() => ({ ...emptyState(), connecting: true, error: null }));
		} else if (wallet.status === 'error') {
			walletStore.set({
				...emptyState(),
				error: wallet.error.message
			});
		} else {
			walletStore.set(emptyState());
		}
		return;
	}

	const walletObj = connectorClient.getConnector(wallet.session.connectorId);
	const account = wallet.session.selectedAccount.account;
	if (!walletObj) {
		connectedWallet = null;
		connectedAccount = null;
		walletStore.set({
			...emptyState(),
			error: 'Connected wallet is unavailable'
		});
		return;
	}

	connectedWallet = walletObj;
	connectedAccount = account;
	const { signer } = accountToSigner(walletObj, account);
	walletStore.set({
		connected: true,
		connecting: false,
		accountAddress: wallet.session.selectedAccount.address,
		signer,
		connectorId: String(wallet.session.connectorId),
		error: null
	});
}

export function clearWalletConnectUri(): void {
	walletConnectUri.set(null);
}

async function waitForConnectors(timeoutMs: number): Promise<boolean> {
	if (!connectorClient) {
		return false;
	}

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		refreshAvailableConnectors();
		if (get(availableConnectors).length > 0) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	return false;
}

async function resetConnectorSession(): Promise<void> {
	if (!connectorClient) {
		return;
	}

	try {
		await connectorClient.disconnectWallet();
	} catch {
		// Ignore disconnect errors while cancelling an in-flight connect.
	}
}

export async function cancelWalletConnection(): Promise<void> {
	connectAttempt += 1;
	clearWalletConnectUri();
	await resetConnectorSession();
	walletStore.set(emptyState());
}

export async function initWallet(): Promise<void> {
	if (!browser || initialized) {
		return;
	}

	const projectId = env.PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
	const origin = window.location.origin;
	const walletConnectConfig = projectId
		? ({
				enabled: true,
				projectId,
				defaultChain: getSolanaChain(),
				metadata: {
					name: 'Phygital NFTs',
					description: 'Phygital trading card viewer and claim',
					url: origin,
					icons: [`${origin}/favicon.svg`]
				},
				getCurrentChain: () => getSolanaChain(),
				onDisplayUri: (uri: string) => {
					walletConnectUri.set(uri);
				},
				onSessionEstablished: () => {
					walletConnectUri.set(null);
				},
				onSessionDisconnected: () => {
					walletConnectUri.set(null);
				}
			} as WalletConnectConfig)
		: undefined;

	connectorClient = new ConnectorClient(
		getDefaultConfig({
			appName: 'Phygital NFTs',
			appUrl: origin,
			network: getNetworkFromRpc(),
			autoConnect: false,
			enableMobile: false,
			wallets: {
				allowList: ['Phantom', 'Solflare', 'Backpack'],
				featured: FEATURED_WALLET_NAMES
			},
			clusters: [
				{
					id: getSolanaChain(),
					label: getNetworkFromRpc() === 'mainnet' ? 'Mainnet' : 'Devnet',
					url: getRpcUrl()
				}
			],
			...(walletConnectConfig ? { walletConnect: walletConnectConfig } : {})
		})
	);

	connectorUnsubscribe = connectorClient.subscribe(() => {
		syncWalletState();
	});

	await ready;

	const connectorsReady = await waitForConnectors(CONNECTOR_INIT_TIMEOUT_MS);
	refreshAvailableConnectors();

	initialized = true;
	walletReady.set(true);

	if (!connectorsReady) {
		walletStore.set({
			...emptyState(),
			error: projectId
				? 'No wallets are available. Install a Solana browser extension or reload the page.'
				: 'No browser wallets detected. Install Phantom or Solflare, or set PUBLIC_WALLETCONNECT_PROJECT_ID for mobile WalletConnect.'
		});
	}
}

export async function connectConnector(connectorId: WalletConnectorId): Promise<void> {
	if (!initialized) {
		throw new Error('Wallet is still initializing');
	}

	if (!connectorClient) {
		throw new Error('Wallet connector is not initialized');
	}

	const connector = get(availableConnectors).find((entry) => entry.id === connectorId);
	if (!connector) {
		throw new Error('Wallet connector not found');
	}

	const attemptId = ++connectAttempt;
	walletStore.update((state) => ({ ...state, connecting: true, error: null }));
	clearWalletConnectUri();

	try {
		await Promise.race([
			connectorClient.connectWallet(connectorId, {
				silent: false,
				allowInteractiveFallback: true
			}),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(
						new Error(
							'Wallet connection timed out. Scan the QR code or approve the request in your wallet app.'
						)
					);
				}, CONNECT_TIMEOUT_MS);
			})
		]);

		if (attemptId !== connectAttempt) {
			return;
		}

		syncWalletState();
	} catch (error) {
		if (attemptId === connectAttempt) {
			await resetConnectorSession();
			walletStore.set({
				...emptyState(),
				error: error instanceof Error ? error.message : 'Failed to connect wallet'
			});
		}
		throw error;
	}
}

export async function disconnectWallet(): Promise<void> {
	connectAttempt += 1;
	clearWalletConnectUri();
	connectedWallet = null;
	connectedAccount = null;
	await resetConnectorSession();
	walletStore.set(emptyState());
}

export function destroyWallet(): void {
	connectorUnsubscribe?.();
	connectorUnsubscribe = null;
	connectorClient?.destroy();
	connectorClient = null;
	initialized = false;
	walletReady.set(false);
}

export function getWalletStoreSnapshot(): WalletState {
	return get(walletStore);
}

export function getConnectorClient(): ConnectorClient | null {
	return connectorClient;
}

function getSignMessageFeature(
	wallet: Wallet
): SolanaSignMessageFeature[typeof SolanaSignMessage] {
	const feature = wallet.features[SolanaSignMessage] as
		| SolanaSignMessageFeature[typeof SolanaSignMessage]
		| undefined;
	if (!feature?.signMessage) {
		throw new Error('Connected wallet does not support message signing.');
	}
	return feature;
}

function getSignTransactionFeature(
	wallet: Wallet
): SolanaSignTransactionFeature[typeof SolanaSignTransaction] {
	const feature = wallet.features[SolanaSignTransaction] as
		| SolanaSignTransactionFeature[typeof SolanaSignTransaction]
		| undefined;
	if (!feature?.signTransaction) {
		throw new Error('Connected wallet does not support transaction signing.');
	}
	return feature;
}

export function getTurboWalletAdapter(): SolanaWalletAdapter {
	if (!connectedWallet || !connectedAccount) {
		throw new Error('Connect your wallet before uploading to Arweave.');
	}

	const wallet = connectedWallet;
	const account = connectedAccount;
	const signMessageFeature = getSignMessageFeature(wallet);
	const signTransactionFeature = getSignTransactionFeature(wallet);

	return {
		publicKey: {
			toString: () => account.address
		},
		signMessage: async (message: Uint8Array) => {
			const [output] = await signMessageFeature.signMessage({ account, message });
			return output.signature;
		},
		signTransaction: async (transaction: Transaction) => {
			const serialized = transaction.serialize({
				requireAllSignatures: false,
				verifySignatures: false
			});
			const [output] = await signTransactionFeature.signTransaction({
				account,
				transaction: new Uint8Array(serialized),
				chain: getSolanaChain()
			});
			return Transaction.from(output.signedTransaction);
		}
	};
}
