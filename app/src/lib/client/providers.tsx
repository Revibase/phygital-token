'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { useEffect } from 'react';

import { BootProvider, type AppBoot } from '#lib/client/boot';
import { persistOptions, queryClient } from '#lib/client/cache.ts';
import { clearStoredOwners } from '#lib/client/memory.ts';
import { configureRpc } from '#lib/client/rpc.ts';
import { WalletProvider } from '#lib/client/wallet/wallet-context';
import { Toaster } from '#lib/components/ui/sonner';

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

function privyChain(cluster: AppBoot['cluster']): 'solana:mainnet' | 'solana:devnet' | 'solana:testnet' {
	if (cluster === 'mainnet') return 'solana:mainnet';
	if (cluster === 'testnet') return 'solana:testnet';
	return 'solana:devnet';
}

export function Providers({ boot, children }: { boot: AppBoot; children: React.ReactNode }) {
	useEffect(() => {
		if (boot.rpcUrl) configureRpc(boot.rpcUrl);
		clearStoredOwners();
	}, [boot.rpcUrl]);

	const chain = privyChain(boot.cluster);
	const websocket = boot.rpcUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

	return (
		<BootProvider boot={boot}>
			<PrivyProvider
				appId={boot.privyAppId}
				config={{
					appearance: {
						walletChainType: 'solana-only',
						walletList: [
							'detected_solana_wallets',
							'wallet_connect_qr_solana'
						],
						showWalletLoginFirst: false
					},
					loginMethods: ["google", 'wallet'],
					externalWallets: {
						solana: { connectors: solanaConnectors }
					},
					embeddedWallets: {
						solana: { createOnLogin: 'users-without-wallets' }
					},
					solana: boot.rpcUrl
						? {
								rpcs: {
									[chain]: {
										rpc: createSolanaRpc(boot.rpcUrl),
										rpcSubscriptions: createSolanaRpcSubscriptions(websocket)
									}
								}
							}
						: undefined
				}}
			>
				<WalletProvider cluster={boot.cluster}>
					<PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
						<Toaster />
						{children}
					</PersistQueryClientProvider>
				</WalletProvider>
			</PrivyProvider>
		</BootProvider>
	);
}
