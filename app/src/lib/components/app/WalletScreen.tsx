'use client';

import { useExportWallet } from '@privy-io/react-auth/solana';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Download } from 'lucide-react';
import { useState } from 'react';

import { useBoot } from '#lib/client/boot';
import { actionFailure, describeError, type FriendlyError } from '#lib/client/link/messages.ts';
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

export function WalletScreen() {
	const wallet = useWallet();
	const { cluster } = useBoot();
	const { exportWallet } = useExportWallet();
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
	const [exporting, setExporting] = useState(false);

	function startSend(next: SendAsset | null) {
		setAsset(next);
		setSending(true);
	}

	async function exportKey() {
		if (!wallet.address) return;
		setExporting(true);
		setActionError(null);
		try {
			await exportWallet({ address: wallet.address });
		} catch (err) {
			setActionError(actionFailure(err));
		} finally {
			setExporting(false);
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
							<div className="grid w-full grid-cols-2 gap-2">
								<div className="h-16 animate-pulse rounded-[14px] bg-muted" />
								<div className="h-16 animate-pulse rounded-[14px] bg-muted" />
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
							<div className="grid w-full grid-cols-2 gap-2">
								<Button
									size="xl"
									variant="secondary"
									className="h-auto flex-col gap-1.5 px-2 py-3.5 text-[13px] whitespace-normal"
									onClick={() => setReceiving(true)}
								>
									<Download className="size-4" />
									Add Funds
								</Button>
								<Button
									size="xl"
									className="h-auto flex-col gap-1.5 px-2 py-3.5 text-[13px] whitespace-normal"
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
								body="Every transfer pays a small fee in SOL. Send a little SOL to this address."
							/>
						) : null}
						<HoldingsList holdings={holdings} onSelect={startSend} />
						{wallet.embedded ? (
							<Button
								variant="quiet"
								className="self-center"
								disabled={exporting}
								onClick={() => void exportKey()}
							>
								{exporting ? 'Opening…' : 'Export private key'}
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
