'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { openOwnedAccessory } from '#lib/client/accessory/open-owned.ts';
import { platform } from '#lib/client/capability.ts';
import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
import { walletAccessoriesQuery } from '#lib/client/queries.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import type { AccessoryView } from '#lib/shared/types.ts';
import { AccessoryRow } from './AccessoryRow';
import { EmptyState } from './EmptyState';
import { List } from './List';
import { ListRowSkeleton } from './ListRowSkeleton';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { PageShell } from './PageShell';
import { WalletConnect } from './WalletConnect';

export function HomeScreen() {
	const wallet = useWallet();
	const [failure, setFailure] = useState<FriendlyError | null>(null);
	const [opening, setOpening] = useState<string | null>(null);
	const [desktop, setDesktop] = useState(false);
	useEffect(() => {
		setDesktop(platform() === 'desktop');
	}, []);

	const listQuery = useQuery({
		...walletAccessoriesQuery(wallet.address ?? ''),
		enabled: !!wallet.address
	});
	const accessories = wallet.address ? (listQuery.data ?? null) : null;
	const listFailure = listQuery.isError && !listQuery.data ? describeError(listQuery.error) : null;

	async function openAccessory(acc: AccessoryView) {
		setOpening(acc.pda);
		setFailure(null);
		try {
			await openOwnedAccessory(wallet.signingContext(), acc.pda);
			window.location.assign('/accessory');
		} catch (err) {
			setFailure(describeError(err));
		} finally {
			setOpening(null);
		}
	}

	return (
		<PageShell
			size="medium"
			connect={false}
			footer={
				wallet.ready && !wallet.address && !desktop ? (
					<p className="text-center text-[14px] text-muted-foreground">
						Have your accessory? Hold it to your phone.
					</p>
				) : null
			}
		>
			<section className="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
				<PageHeader
					title="Your accessories"
					body={
						wallet.ready && !wallet.address
							? 'Connect a wallet to see the accessories it owns.'
							: undefined
					}
				/>
				<Notice
					error={failure ?? listFailure}
					onretry={listFailure && !failure ? () => void listQuery.refetch() : undefined}
					retrying={listQuery.isFetching}
				/>
				{!wallet.ready ? (
					<List>
						{[0, 1].map((i) => (
							<ListRowSkeleton key={i} avatar="size-12 rounded-[26%]" detail />
						))}
					</List>
				) : !wallet.address ? (
					<WalletConnect />
				) : accessories === null && !failure && !listFailure ? (
					<List>
						{[0, 1].map((i) => (
							<ListRowSkeleton key={i} avatar="size-12 rounded-[26%]" detail />
						))}
					</List>
				) : accessories?.length === 0 ? (
					<EmptyState title="No accessories yet" body="Hold one to your phone to claim it." />
				) : accessories?.length ? (
					<List>
						{accessories.map((acc) => (
							<AccessoryRow
								key={acc.pda}
								accessory={acc}
								busy={opening === acc.pda}
								onClick={() => void openAccessory(acc)}
							/>
						))}
					</List>
				) : null}
			</section>
		</PageShell>
	);
}
