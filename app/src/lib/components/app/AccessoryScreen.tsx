'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { managementActions, tapScreen } from '#lib/client/accessory/screen.ts';
import { useBoot } from '#lib/client/boot';
import { accessoryMediaQuery, accessoryAppsQuery } from '#lib/client/queries.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import { Skeleton } from '#lib/components/ui/skeleton';
import type { AccessoryView } from '#lib/shared/types.ts';
import { AccessoryMark } from './AccessoryMark';
import { CollectibleDialog } from './CollectibleDialog';
import { EmbedBrowser } from './EmbedBrowser';
import { List } from './List';
import { ListRow } from './ListRow';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { ReleaseSheet } from './ReleaseSheet';
import { ResponsiveSheet } from './ResponsiveSheet';
import { AppGrid } from './AppGrid';
import { TechnicalDetails } from './TechnicalDetails';
import { WalletRow } from './WalletRow';

export function AccessoryScreen({
	accessory,
	loadError
}: {
	accessory: AccessoryView | null;
	loadError: boolean;
}) {
	const wallet = useWallet();
	const boot = useBoot();
	const router = useRouter();
	const [nftOpen, setNftOpen] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [releaseOpen, setReleaseOpen] = useState(false);
	const [manageOpen, setManageOpen] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [embedded, setEmbedded] = useState<{ href: string; label: string } | null>(null);

	useEffect(() => {
		const refreshLink = () => {
			if (document.visibilityState !== 'visible') return;
			router.refresh();
		};
		window.addEventListener('focus', refreshLink);
		window.addEventListener('storage', refreshLink);
		document.addEventListener('visibilitychange', refreshLink);
		return () => {
			window.removeEventListener('focus', refreshLink);
			window.removeEventListener('storage', refreshLink);
			document.removeEventListener('visibilitychange', refreshLink);
		};
	}, [router]);

	const owned = !!accessory?.owner && wallet.address === accessory.owner;
	const screen = accessory ? tapScreen(accessory, owned) : null;
	const management = accessory ? managementActions(accessory, owned) : null;
	const mediaQuery = useQuery({
		...accessoryMediaQuery(accessory?.pda ?? ''),
		enabled: !!accessory?.mint
	});
	const media = mediaQuery.data ?? null;
	const namedCollectible = !!accessory?.mint;
	const collectibleLoading = namedCollectible && mediaQuery.isPending;
	const collectibleName = namedCollectible ? media?.name : null;
	const appsQuery = useQuery({
		...accessoryAppsQuery(accessory?.pda ?? '', accessory?.owner ?? null),
		enabled: !!accessory?.mint
	});
	const apps = appsQuery.data ?? [];

	function openManagement() {
		if (management?.hasActions) setManageOpen(true);
		else setDetailsOpen(true);
	}

	const actions =
		accessory && screen ? (
			screen.claim ? (
				<div className="grid gap-1">
					<Button href="/accessory/link" size="xl">
						Claim accessory
					</Button>
					<Button variant="quiet" className="w-full" onClick={openManagement}>
						{management?.hasActions ? 'Manage accessory' : 'Details'}
					</Button>
				</div>
			) : (
				<Button variant="quiet" className="w-full" onClick={openManagement}>
					{management?.hasActions ? 'Manage accessory' : 'Details'}
				</Button>
			)
		) : null;

	return (
		<>
			<PageShell size="wide" footer={<div className="lg:hidden">{actions}</div>}>
				{!accessory || !screen || loadError ? (
					<section className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
						<Notice
							title="Couldn’t load this accessory"
							body="It’s genuine, but the network didn’t respond."
							onretry={() => {
								setRefreshing(true);
								router.refresh();
								setRefreshing(false);
							}}
							retrying={refreshing}
						/>
					</section>
				) : (
					<section className="flex flex-1 flex-col justify-center gap-6 pt-4 pb-10 [@media(max-height:640px)]:gap-4 [@media(max-height:640px)]:pb-2 lg:grid lg:flex-none lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16 lg:py-0">
						<div className="flex justify-center">
							{accessory.mint ? (
								<button
									type="button"
									aria-label="View NFT details"
									className="rounded-[26%] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
									onClick={() => {
										setNftOpen(true);
										void mediaQuery.refetch();
									}}
								>
									<AccessoryMark
										state="verified"
										size="xl"
										pda={accessory.pda}
										hasMint={!!accessory.mint}
										className="[@media(max-height:640px)]:size-20"
									/>
								</button>
							) : (
								<AccessoryMark
									state="verified"
									size="xl"
									pda={accessory.pda}
									hasMint={!!accessory.mint}
									className="[@media(max-height:640px)]:size-20"
								/>
							)}
						</div>
						<div className="flex flex-col gap-8 lg:gap-6">
							{collectibleLoading ? (
								<div className="flex flex-col items-center gap-3 lg:items-start" aria-hidden="true">
									<Skeleton className="h-3.5 w-24" />
									<Skeleton className="h-7 w-56" />
									<Skeleton className="h-4 w-64" />
								</div>
							) : collectibleName ? (
								<PageHeader
									align="center-mobile"
									eyebrow={`Genuine · ${accessory.tag}`}
									eyebrowTone="success"
									title={collectibleName}
									body={media?.collection ? `${media.collection} · ${screen.title}` : screen.title}
								>
									{screen.body ? (
										<p className="text-[15px] leading-relaxed text-muted-foreground">
											{screen.body}
										</p>
									) : null}
								</PageHeader>
							) : (
								<PageHeader
									align="center-mobile"
									eyebrow={`Genuine · ${accessory.tag}`}
									eyebrowTone="success"
									title={screen.title}
									body={screen.body || undefined}
								/>
							)}
							{accessory.owner ? (
								<List label="Owner">
									<WalletRow
										address={accessory.owner}
										label={owned ? 'Your wallet' : undefined}
										nftOwnership={
											media?.owner ? (media.owner === accessory.owner ? 'same' : 'different') : null
										}
										href={owned ? '/wallet' : undefined}
									/>
								</List>
							) : null}
							{apps.length ? (
								<AppGrid
									label={media?.collection ? `From ${media.collection}` : 'Apps'}
									items={apps}
									onEmbed={(app) => setEmbedded({ href: app.href, label: app.label })}
								/>
							) : accessory.mint && appsQuery.isError ? (
								<Notice
									title="Couldn’t load project apps"
									onretry={() => void appsQuery.refetch()}
									retrying={appsQuery.isFetching}
								/>
							) : null}
							<div className="hidden lg:block">{actions}</div>
						</div>
					</section>
				)}
			</PageShell>
			{accessory && screen ? (
				<>
					<ResponsiveSheet open={manageOpen} onOpenChange={setManageOpen} title="Manage accessory">
						<List>
							{management?.changeOwner ? (
								<ListRow
									label="Change owner"
									detail="Claim it with another wallet"
									href="/accessory/link"
									chevron
								/>
							) : null}
							{management?.release ? (
								<ListRow
									label="Release accessory"
									detail="Let someone else claim it"
									tone="destructive"
									chevron
									onClick={() => {
										setManageOpen(false);
										setReleaseOpen(true);
									}}
								/>
							) : null}
							<ListRow
								label="Accessory details"
								chevron
								onClick={() => {
									setManageOpen(false);
									setDetailsOpen(true);
								}}
							/>
						</List>
					</ResponsiveSheet>
					<TechnicalDetails
						accessory={accessory}
						cluster={boot.cluster}
						open={detailsOpen}
						onOpenChange={setDetailsOpen}
					/>
					{accessory.canRelease ? (
						<ReleaseSheet accessory={accessory} open={releaseOpen} onOpenChange={setReleaseOpen} />
					) : null}
				</>
			) : null}
			{embedded ? (
				<EmbedBrowser
					href={embedded.href}
					label={embedded.label}
					onClose={() => setEmbedded(null)}
				/>
			) : null}
			{accessory?.mint ? (
				<CollectibleDialog
					mint={accessory.mint}
					media={media}
					loading={mediaQuery.isPending}
					cluster={boot.cluster}
					open={nftOpen}
					onOpenChange={setNftOpen}
				/>
			) : null}
		</>
	);
}
