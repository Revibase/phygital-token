'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { managementActions, tapScreen } from '#lib/client/accessory/screen.ts';
import { useBoot } from '#lib/client/boot';
import { accessoryMediaQuery, accessoryProjectQuery } from '#lib/client/queries.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Skeleton } from '#lib/components/ui/skeleton';
import { shortAddress } from '#lib/shared/encoding.ts';
import { mainButton, pickFeatured, type Audience } from '#lib/shared/project-page.ts';
import type { AccessoryView } from '#lib/shared/types.ts';
import { AccessoryMark } from './AccessoryMark';
import { CollectibleDialog } from './CollectibleDialog';
import { EmbedBrowser } from './EmbedBrowser';
import { HeroVisual } from './HeroVisual';
import { List } from './List';
import { ListRow } from './ListRow';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { PinnedAction } from './PinnedAction';
import { ProjectSurface } from './ProjectSurface';
import { ReleaseSheet } from './ReleaseSheet';
import { ResponsiveSheet } from './ResponsiveSheet';
import { AppGrid } from './AppGrid';
import { Section } from './Section';
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
	const projectQuery = useQuery({
		...accessoryProjectQuery(accessory?.pda ?? '', accessory?.owner ?? null),
		enabled: !!accessory?.mint
	});
	const project = projectQuery.data ?? null;
	const audience: Audience = !accessory?.owner ? 'unclaimed' : owned ? 'owner' : 'visitor';
	// Until the wallet restores, an owner would briefly see what a visitor sees.
	const featured =
		project && (audience === 'unclaimed' || wallet.ready)
			? pickFeatured(project.featured, audience)
			: null;
	const main = screen ? mainButton(featured, screen.claim) : null;
	// Every app stays in the row, the main button's too: the row is the full list, the button a shortcut to one.
	const apps = project?.apps ?? [];
	const projectName = media?.collection ?? project?.host ?? null;
	const status = accessory?.owner
		? owned
			? 'Owned by you'
			: `Owned by ${shortAddress(accessory.owner)}`
		: collectibleName
			? screen?.title
			: null;
	const openApp = (app: { href: string; label: string }) =>
		setEmbedded({ href: app.href, label: app.label });
	const openNft = () => {
		setNftOpen(true);
		void mediaQuery.refetch();
	};

	const action = main ? (
		<PinnedAction main={main} accent={project?.style.accent ?? null} onEmbed={openApp} />
	) : null;

	return (
		<>
			<ProjectSurface background={project?.style.background ?? null}>
				<PageShell
					size="wide"
					stickyFooter
					footer={action ? <div className="lg:hidden">{action}</div> : undefined}
				>
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
						<section className="flex flex-1 flex-col justify-center gap-6 pt-4 pb-6 [@media(max-height:640px)]:gap-4 [@media(max-height:640px)]:pb-2 lg:grid lg:flex-none lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16 lg:py-0">
							<div className="relative flex justify-center">
								{featured?.image ? (
									<HeroVisual image={featured.image} pda={accessory.pda} onOpenNft={openNft} />
								) : accessory.mint ? (
									<button
										type="button"
										aria-label="View NFT details"
										className="relative rounded-[26%] outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
										onClick={openNft}
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
										className="relative [@media(max-height:640px)]:size-20"
									/>
								)}
							</div>
							<div className="flex flex-col gap-7 lg:gap-6">
								{collectibleLoading ? (
									<div
										className="flex flex-col items-center gap-3 lg:items-start"
										aria-hidden="true"
									>
										<Skeleton className="h-3.5 w-24" />
										<Skeleton className="h-7 w-56" />
										<Skeleton className="h-4 w-64" />
									</div>
								) : (
									<PageHeader
										align="center-mobile"
										eyebrow={`Genuine · ${accessory.tag}`}
										eyebrowTone="success"
										title={collectibleName ?? screen.title}
										body={featured ? undefined : (media?.collection ?? undefined)}
									>
										{featured ? (
											<div className="grid gap-0.5">
												<p className="text-[17px] leading-snug font-semibold">{featured.title}</p>
												{featured.text ? (
													<p className="text-[15px] leading-snug text-muted-foreground">
														{featured.text}
													</p>
												) : null}
											</div>
										) : null}
										{screen.body ? (
											<p className="text-[15px] leading-relaxed text-muted-foreground">
												{screen.body}
											</p>
										) : null}
										<p className="flex items-center justify-center gap-1.5 pt-1 text-[14px] text-muted-foreground lg:justify-start">
											{status ? (
												<>
													<span>{status}</span>
													<span aria-hidden="true">·</span>
												</>
											) : null}
											<button
												type="button"
												className="-my-2 rounded-md py-2 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
												onClick={() => setManageOpen(true)}
											>
												{management?.hasActions ? 'Manage' : 'Details'}
											</button>
										</p>
									</PageHeader>
								)}
								{apps.length ? (
									<Section label={projectName ? `More from ${projectName}` : 'Apps'}>
										<AppGrid
											items={apps}
											accent={project?.style.accent ?? null}
											onEmbed={openApp}
										/>
									</Section>
								) : accessory.mint && projectQuery.isError ? (
									<Notice
										title="Couldn’t load the project’s apps"
										onretry={() => void projectQuery.refetch()}
										retrying={projectQuery.isFetching}
									/>
								) : null}
								{action ? <div className="hidden lg:block">{action}</div> : null}
							</div>
						</section>
					)}
				</PageShell>
			</ProjectSurface>
			{accessory && screen ? (
				<>
					<ResponsiveSheet
						open={manageOpen}
						onOpenChange={setManageOpen}
						title={management?.hasActions ? 'Manage accessory' : 'Accessory'}
					>
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
