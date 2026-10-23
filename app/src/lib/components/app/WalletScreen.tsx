'use client';

import { useAddFunds } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Download } from 'lucide-react';
import { useState } from 'react';

import { useBoot } from '#lib/client/boot';
import { describeError, isDismissedFlow, type FriendlyError } from '#lib/client/link/messages.ts';
import { walletHoldingsQuery } from '#lib/client/queries.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import { formatUsd, portfolioUsd } from '#lib/shared/wallet-holdings.ts';
import { needsSolForFees, type SendAsset } from '#lib/shared/wallet-transfer.ts';
import { HoldingsList } from './HoldingsList';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { ReceiveSheet } from './ReceiveSheet';
import { SendSheet } from './SendSheet';
import { WalletAccount } from './WalletAccount';
import { WalletConnect } from './WalletConnect';

/** CAIP-2 chain ids. `solana:devnet` is not a chain Privy can fund. */
const FUND_CHAIN = {
	mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
} as const;

export function WalletScreen() {
	const wallet = useWallet();
	const { cluster } = useBoot();
	const { exportWallet } = useExportWallet();
	const { addFunds } = useAddFunds();
	const query = useQuery({
		...walletHoldingsQuery(wallet.address ?? ''),
		enabled: !!wallet.address
	});
	const holdings = wallet.address ? query.data : undefined;
	const failure = query.isError && !query.data ? describeError(query.error) : null;
	const usd = holdings ? portfolioUsd(holdings) : null;
	const [receiving, setReceiving] = useState(false);
	const [sending, setSending] = useState(false);
	const [asset, setAsset] = useState<SendAsset | null>({ kind: 'sol' });
	const [actionError, setActionError] = useState<FriendlyError | null>(null);
	const [acting, setActing] = useState<'deposit' | 'export' | null>(null);
	const canFund = cluster === 'mainnet' || cluster === 'devnet';

	function startSend(next: SendAsset | null) {
		setAsset(next);
		setSending(true);
	}

	async function deposit() {
		if (!wallet.address) return;
		setActing('deposit');
		setActionError(null);
		try {
			await addFunds({
				destination: {
					address: wallet.address,
					asset: 'sol',
					chain: cluster === 'mainnet' ? FUND_CHAIN.mainnet : FUND_CHAIN.devnet
				},
				fiat: {
					source: { assets: ['usd'], defaultAsset: 'usd' },
					environment: cluster === 'mainnet' ? 'production' : 'sandbox',
					defaultAmount: '25'
				}
			});
		} catch (err) {
			if (!isDismissedFlow(err)) setActionError(describeError(err));
		} finally {
			setActing(null);
		}
	}

	async function exportKey() {
		if (!wallet.address) return;
		setActing('export');
		setActionError(null);
		try {
			await exportWallet({ address: wallet.address });
		} catch (err) {
			if (!isDismissedFlow(err)) setActionError(describeError(err));
		} finally {
			setActing(null);
		}
	}

	return (
		<PageShell size="narrow" back brand={false}>
			<section className="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
				{!wallet.ready ? (
					<>
						<div className="flex flex-col items-center gap-5" aria-hidden="true">
							<div className="h-11 w-36 animate-pulse rounded-full bg-muted" />
							<div className="h-10 w-44 animate-pulse rounded-lg bg-muted" />
							<div className="grid w-full grid-cols-2 gap-3">
								<div className="h-13 animate-pulse rounded-[14px] bg-muted" />
								<div className="h-13 animate-pulse rounded-[14px] bg-muted" />
							</div>
						</div>
						<HoldingsList holdings={undefined} />
					</>
				) : wallet.address ? (
					<>
						<div className="flex flex-col items-center gap-5">
							<h1 className="sr-only">Wallet</h1>
							<WalletAccount address={wallet.address} label={wallet.walletName ?? 'Your wallet'} />
							{!holdings ? (
								<div className="h-10 w-44 animate-pulse rounded-lg bg-muted" />
							) : usd !== null ? (
								<p className="text-center text-[40px] leading-none font-semibold tracking-tight tabular-nums">
									{formatUsd(usd)}
								</p>
							) : null}
							<div className="grid w-full grid-cols-2 gap-3">
								<Button size="xl" variant="secondary" onClick={() => setReceiving(true)}>
									<Download className="size-4" />
									Add Funds
								</Button>
								<Button
									size="xl"
									disabled={!holdings}
									onClick={() =>
										startSend(
											holdings?.tokens.some((token) => !token.frozen) ? null : { kind: 'sol' }
										)
									}
								>
									<ArrowUpRight className="size-4" />
									Send
								</Button>
							</div>
						</div>
						<Notice
							error={failure ?? actionError}
							onretry={failure ? () => void query.refetch() : undefined}
							retrying={query.isFetching}
						/>
						{holdings && needsSolForFees(holdings) ? (
							<Notice
								tone="info"
								title="Add SOL for network fees"
								body="Every transfer pays a small fee in SOL. Buy with a card, or send SOL to your address."
							/>
						) : null}
						<HoldingsList holdings={holdings} onSelect={startSend} />
						{wallet.embedded ? (
							<Button
								variant="quiet"
								className="self-center"
								disabled={acting === 'export'}
								onClick={() => void exportKey()}
							>
								{acting === 'export' ? 'Opening…' : 'Export private key'}
							</Button>
						) : null}
					</>
				) : (
					<>
						<PageHeader
							title="Wallet"
							body="Sign in to create a wallet, or connect one you already have."
						/>
						<WalletConnect />
					</>
				)}
			</section>
			{wallet.address ? (
				<>
					<ReceiveSheet
						open={receiving}
						onOpenChange={setReceiving}
						address={wallet.address}
						cluster={cluster}
						onBuy={canFund ? () => void deposit() : undefined}
						buying={acting === 'deposit'}
					/>
					<SendSheet
						open={sending}
						onOpenChange={setSending}
						holdings={holdings}
						asset={asset}
						cluster={cluster}
					/>
				</>
			) : null}
		</PageShell>
	);
}
