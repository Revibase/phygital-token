import { ConnectorClient, getDefaultConfig, type ConnectorState } from '@solana/connector/headless';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
	SolanaSignAndSendTransaction,
	SolanaSignMessage,
	SolanaSignTransaction,
	type SolanaSignAndSendTransactionFeature,
	type SolanaSignMessageFeature,
	type SolanaSignTransactionFeature
} from '@solana/wallet-standard-features';

import { platform } from '../capability';
import { bytesToBase64Url } from '$lib/shared/encoding';
import { FEATURED_WALLET_NAMES } from './catalog';

export type Cluster = 'mainnet' | 'devnet' | 'testnet' | 'localnet';

export type WalletOption = { id: string; name: string; icon: string; ready: boolean };

export type SigningContext = {
	wallet: Wallet;
	account: WalletAccount;
	address: string;
	chain: `solana:${string}`;
};

/**
 * Svelte 5 wrapper around `@solana/connector`'s headless client.
 *
 * Signing goes straight through the Wallet Standard features of the connected
 * wallet, with transactions we compile ourselves (Kit v8). That keeps us
 * independent of the connector's own Kit v7 signer types.
 */
class WalletStore {
	#client: ConnectorClient | null = null;
	#cluster: Cluster = 'devnet';
	state = $state<ConnectorState | null>(null);

	init(cluster: Cluster) {
		if (this.#client || typeof window === 'undefined') return;
		this.#cluster = cluster;
		const client = new ConnectorClient(
			getDefaultConfig({
				appName: 'Revibase',
				appUrl: window.location.origin,
				autoConnect: true,
				network: cluster,
				wallets: { featured: FEATURED_WALLET_NAMES }
			})
		);
		(client as unknown as { initialize?: () => void }).initialize?.();
		this.#client = client;
		this.state = client.getSnapshot();
		client.subscribe((s) => (this.state = s));
		if (platform() === 'android' && cluster !== 'localnet') void this.#registerMobileWalletAdapter(cluster);
	}

	async #registerMobileWalletAdapter(cluster: Exclude<Cluster, 'localnet'>) {
		try {
			const mwa = await import('@solana-mobile/wallet-standard-mobile');
			mwa.registerMwa({
				appIdentity: { name: 'Revibase', uri: window.location.origin, icon: 'icon-192.png' },
				authorizationCache: mwa.createDefaultAuthorizationCache(),
				chains: [`solana:${cluster}`],
				chainSelector: mwa.createDefaultChainSelector(),
				onWalletNotFound: mwa.createDefaultWalletNotFoundHandler()
			});
		} catch (err) {
			console.warn('Mobile Wallet Adapter unavailable', err);
		}
	}

	get options(): WalletOption[] {
		return (this.state?.connectors ?? [])
			.filter((c) => c.features.includes(SolanaSignTransaction) || c.features.includes(SolanaSignAndSendTransaction))
			.map((c) => ({ id: c.id, name: c.name, icon: c.icon, ready: c.ready }));
	}

	get status() {
		return this.state?.wallet.status ?? 'disconnected';
	}

	get address(): string | null {
		const w = this.state?.wallet;
		return w?.status === 'connected' ? String(w.session.selectedAccount.address) : null;
	}

	get walletName(): string | null {
		const w = this.state?.wallet;
		if (w?.status !== 'connected') return null;
		return this.state?.connectors.find((c) => c.id === w.session.connectorId)?.name ?? null;
	}

	get walletIcon(): string | null {
		const w = this.state?.wallet;
		if (w?.status !== 'connected') return null;
		return this.state?.connectors.find((c) => c.id === w.session.connectorId)?.icon ?? null;
	}

	get error(): Error | null {
		const w = this.state?.wallet;
		return w?.status === 'error' ? w.error : null;
	}

	async connect(id: string) {
		if (!this.#client) throw new Error('Wallet connector not initialised');
		await this.#client.connectWallet(id as Parameters<ConnectorClient['connectWallet']>[0]);
	}

	async disconnect() {
		await this.#client?.disconnectWallet();
		// Best effort: the wallet login and any owner_browse it issued end with the connection.
		void fetch('/api/owner/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
	}

	signingContext(): SigningContext {
		const w = this.state?.wallet;
		if (!this.#client || w?.status !== 'connected') throw new Error('Connect a wallet first.');
		const wallet = this.#client.getConnector(w.session.connectorId);
		if (!wallet) throw new Error('This wallet is no longer available.');
		return {
			wallet,
			account: w.session.selectedAccount.account,
			address: String(w.session.selectedAccount.address),
			chain: `solana:${this.#cluster === 'localnet' ? 'localnet' : this.#cluster}`
		};
	}
}

export const walletStore = new WalletStore();

export type SignOutcome = { kind: 'signed'; signedBytes: Uint8Array } | { kind: 'sent'; signature: Uint8Array };

/**
 * Ask the wallet to sign exactly `wireBytes`. Prefer sign-only so the signed
 * copy can be re-validated before it is broadcast; fall back to
 * sign-and-send for wallets that only offer that.
 */
export async function signWithWallet(ctx: SigningContext, wireBytes: Uint8Array): Promise<SignOutcome> {
	const features = ctx.wallet.features as Partial<SolanaSignTransactionFeature & SolanaSignAndSendTransactionFeature>;
	const signOnly = features[SolanaSignTransaction];
	if (signOnly) {
		const [result] = await signOnly.signTransaction({ account: ctx.account, transaction: wireBytes, chain: ctx.chain });
		return { kind: 'signed', signedBytes: new Uint8Array(result.signedTransaction) };
	}
	const signAndSend = features[SolanaSignAndSendTransaction];
	if (signAndSend) {
		const [result] = await signAndSend.signAndSendTransaction({
			account: ctx.account,
			transaction: wireBytes,
			chain: ctx.chain
		});
		return { kind: 'sent', signature: new Uint8Array(result.signature) };
	}
	throw new Error('This wallet can’t sign Solana transactions.');
}

export async function signMessageWithWallet(ctx: SigningContext, message: string): Promise<string> {
	const features = ctx.wallet.features as Partial<SolanaSignMessageFeature>;
	const sign = features[SolanaSignMessage];
	if (!sign) throw new Error('This wallet can’t sign messages.');
	const bytes = new TextEncoder().encode(message);
	const [result] = await sign.signMessage({ account: ctx.account, message: bytes });
	return bytesToBase64Url(new Uint8Array(result.signature));
}
