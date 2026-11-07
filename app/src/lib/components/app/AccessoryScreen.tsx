'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { managementActions, tapScreen } from '#lib/client/accessory/screen.ts';
import { useBoot } from '#lib/client/boot';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import { shortAddress } from '#lib/shared/encoding.ts';
import type { AccessoryView } from '#lib/shared/types.ts';
import { AccessoryMark } from './AccessoryMark';
import { List } from './List';
import { ListRow } from './ListRow';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { ReleaseSheet } from './ReleaseSheet';
import { ResponsiveSheet } from './ResponsiveSheet';
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
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [releaseOpen, setReleaseOpen] = useState(false);
	const [manageOpen, setManageOpen] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

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
	const status = accessory?.owner
		? owned
			? 'Owned by you'
			: `Owned by ${shortAddress(accessory.owner)}`
		: null;

	const action = screen?.claim ? (
		<Button href="/accessory/link" size="xl">
			Claim accessory
		</Button>
	) : null;

	return (
		<>
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
							<AccessoryMark
								state="verified"
								size="xl"
								className="relative [@media(max-height:640px)]:size-20"
							/>
						</div>
						<div className="flex flex-col gap-7 lg:gap-6">
							<PageHeader
								align="center-mobile"
								eyebrow={`Genuine · ${accessory.tag}`}
								eyebrowTone="success"
								title={screen.title}
							>
								{screen.body ? (
									<p className="text-[15px] leading-relaxed text-muted-foreground">{screen.body}</p>
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
							{action ? <div className="hidden lg:block">{action}</div> : null}
						</div>
					</section>
				)}
			</PageShell>
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
		</>
	);
}
