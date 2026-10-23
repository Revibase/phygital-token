'use client';

import { useLogin, usePrivy, type User, type WalletWithMetadata } from '@privy-io/react-auth';
import { useWallets, type ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState
} from 'react';

import { shortAddress } from '#lib/shared/encoding.ts';
import { signFeatures, walletSupports, type Cluster, type SigningContext } from './wallet';

type WalletContextValue = {
	ready: boolean;
	pending: boolean;
	address: string | null;
	walletName: string | null;
	embedded: boolean;
	approvePrompt: string;
	connect: (options?: { requireAddress?: string | null }) => Promise<void>;
	disconnect: () => Promise<void>;
	signingContext: () => SigningContext;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/** Privy closed its login. It already showed the cancel or the error, so callers stay quiet. */
export class SignInCancelled extends Error {
	constructor() {
		super('Sign-in was cancelled.');
		this.name = 'SignInCancelled';
	}
}

function isSolanaWallet(account: {
	type: string;
	chainType?: string;
	address?: string;
}): account is WalletWithMetadata {
	return account.type === 'wallet' && account.chainType === 'solana' && !!account.address;
}

function solanaAddressFromUser(user: User, loginMethod: string | null): string | null {
	const wallets = user.linkedAccounts.filter(isSolanaWallet);
	const external = loginMethod === 'wallet' || loginMethod === 'siws';
	const picked = external
		? (wallets.find((account) => account.walletClientType !== 'privy') ?? wallets[0])
		: (wallets.find((account) => account.walletClientType === 'privy') ?? wallets[0]);
	return picked?.address ?? null;
}

function accountPublicKey(wallet: ConnectedStandardSolanaWallet): Uint8Array {
	const account = wallet.standardWallet.accounts.find((item) => item.address === wallet.address);
	return new Uint8Array(account?.publicKey ?? new Uint8Array());
}

function toSigningContext(
	wallet: ConnectedStandardSolanaWallet,
	cluster: Cluster,
	embedded: boolean
): SigningContext {
	const walletName = wallet.standardWallet.name;
	const features = wallet.standardWallet.features as Record<string, unknown>;
	const chain = `solana:${cluster}` as const;
	return {
		address: wallet.address,
		chain,
		walletName,
		embedded,
		publicKey: accountPublicKey(wallet),
		signTransaction: walletSupports(features, signFeatures.transaction)
			? async (wireBytes) => {
					const { signedTransaction } = await wallet.signTransaction({
						transaction: wireBytes,
						chain
					});
					return new Uint8Array(signedTransaction);
				}
			: undefined,
		signAndSendTransaction: walletSupports(features, signFeatures.send)
			? async (wireBytes) => {
					const { signature } = await wallet.signAndSendTransaction({
						transaction: wireBytes,
						chain
					});
					return new Uint8Array(signature);
				}
			: undefined,
		signMessage: walletSupports(features, signFeatures.message)
			? async (message) => {
					const { signature } = await wallet.signMessage({ message });
					return new Uint8Array(signature);
				}
			: undefined
	};
}

export function WalletProvider({
	cluster,
	children
}: {
	cluster: Cluster;
	children: React.ReactNode;
}) {
	const { wallets, ready: walletsReady } = useWallets();
	const { user, logout, ready: privyReady } = usePrivy();
	const [selected, setSelected] = useState<string | null>(null);
	const [released, setReleased] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const waiter = useRef<{
		requireAddress: string | null;
		resolve: () => void;
		reject: (error: unknown) => void;
	} | null>(null);

	const { login } = useLogin({
		onComplete: ({ user: loggedIn, loginMethod }) => {
			const address = solanaAddressFromUser(loggedIn, loginMethod ?? null);
			const pending = waiter.current;
			waiter.current = null;
			setConnecting(false);
			if (!address) {
				pending?.reject(new Error('No Solana wallet is available for this account.'));
				return;
			}
			if (pending?.requireAddress && address !== pending.requireAddress) {
				void logout();
				pending.reject(
					Object.assign(new Error('Not the owner’s wallet'), {
						title: 'Not the owner’s wallet',
						body: `Choose ${shortAddress(pending.requireAddress)}.`
					})
				);
				return;
			}
			setReleased(false);
			setSelected(address);
			pending?.resolve();
		},
		onError: () => {
			const pending = waiter.current;
			waiter.current = null;
			setConnecting(false);
			pending?.reject(new SignInCancelled());
		}
	});

	const active =
		released || !user
			? null
			: (wallets.find((wallet) => wallet.address === selected) ?? wallets[0] ?? null);
	const embedded = !!user?.linkedAccounts.some(
		(account) =>
			isSolanaWallet(account) &&
			account.walletClientType === 'privy' &&
			account.address === active?.address
	);

	useEffect(() => {
		if (cluster === 'localnet' || typeof window === 'undefined') return;
		let cancelled = false;
		void import('@solana-mobile/wallet-standard-mobile')
			.then((mwa) => {
				if (cancelled) return;
				mwa.registerMwa({
					appIdentity: { name: 'Revibase', uri: window.location.origin, icon: '/icon-192.png' },
					authorizationCache: mwa.createDefaultAuthorizationCache(),
					chains: [`solana:${cluster}`],
					chainSelector: mwa.createDefaultChainSelector(),
					onWalletNotFound: mwa.createDefaultWalletNotFoundHandler()
				});
			})
			.catch((err: unknown) => {
				console.warn('Mobile Wallet Adapter unavailable', err);
			});
		return () => {
			cancelled = true;
		};
	}, [cluster]);

	const connect = useCallback(
		(options?: { requireAddress?: string | null }) => {
			setConnecting(true);
			return new Promise<void>((resolve, reject) => {
				waiter.current = {
					requireAddress: options?.requireAddress ?? null,
					resolve,
					reject
				};
				login();
			});
		},
		[login]
	);

	const disconnect = useCallback(async () => {
		const current = active;
		setReleased(true);
		setSelected(null);
		try {
			await logout();
		} finally {
			void Promise.resolve()
				.then(() => current?.disconnect())
				.catch(() => {});
			void fetch('/api/owner/session', { method: 'DELETE', credentials: 'same-origin' }).catch(
				() => {}
			);
		}
	}, [active, logout]);

	const ready = privyReady && walletsReady;
	const value = useMemo<WalletContextValue>(() => {
		const walletName = active?.standardWallet.name ?? null;
		return {
			ready,
			pending: !ready || connecting,
			address: active?.address ?? null,
			walletName,
			embedded,
			approvePrompt: `Approve in ${walletName ?? 'your wallet'}…`,
			connect,
			disconnect,
			signingContext: () => {
				if (!active) throw new Error('Connect a wallet first.');
				return toSigningContext(active, cluster, embedded);
			}
		};
	}, [active, cluster, connect, connecting, disconnect, embedded, ready]);

	return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
	const value = useContext(WalletContext);
	if (!value) throw new Error('useWallet must be used inside WalletProvider');
	return value;
}
