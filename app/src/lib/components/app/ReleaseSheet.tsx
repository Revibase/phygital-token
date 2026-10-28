'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { isConnectedAccessoryOwner } from '#lib/client/accessory/ownership.ts';
import { actionFailure, describeError, type FriendlyError } from '#lib/client/link/messages.ts';
import { releaseAccessory } from '#lib/client/link/flow.ts';
import { useWallet } from '#lib/client/wallet/wallet-context';
import { Button } from '#lib/components/ui/button';
import { Spinner } from '#lib/components/ui/spinner';
import { shortAddress } from '#lib/shared/encoding.ts';
import type { AccessoryView } from '#lib/shared/types.ts';
import { List } from './List';
import { Notice } from './Notice';
import { ResponsiveSheet } from './ResponsiveSheet';
import { WalletConnect } from './WalletConnect';
import { WalletRow } from './WalletRow';

export function ReleaseSheet({
	accessory,
	open,
	onOpenChange
}: {
	accessory: AccessoryView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const wallet = useWallet();
	const router = useRouter();
	const [choosing, setChoosing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<FriendlyError | null>(null);
	const linked = accessory.owner ? shortAddress(accessory.owner) : 'its owner';
	const isOwner = isConnectedAccessoryOwner(accessory.owner, wallet.address);
	const outcome = `${isOwner ? 'You’ll' : `${linked} will`} no longer own it. Anyone can claim it next.`;

	async function release() {
		if (!isConnectedAccessoryOwner(accessory.owner, wallet.address)) {
			setFailure(describeError(new Error('Connect the accessory owner’s wallet to release it.')));
			return;
		}
		setBusy(true);
		setFailure(null);
		try {
			await releaseAccessory(wallet.signingContext(), accessory.pda);
			toast.success('Accessory released');
			onOpenChange(false);
			router.refresh();
		} catch (err) {
			setFailure(actionFailure(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<ResponsiveSheet
			open={open}
			onOpenChange={onOpenChange}
			title="Release this accessory?"
			description={outcome}
		>
			<Notice error={failure} />
			<WalletConnect
				open={choosing}
				onOpenChange={setChoosing}
				showButton={!wallet.address}
				requireAddress={accessory.owner}
				onConnected={() => setFailure(null)}
				onError={setFailure}
			/>
			{wallet.address ? (
				<>
					<List>
						<WalletRow address={wallet.address} label="Your wallet" />
					</List>
					{isOwner ? (
						<Button
							variant="destructive"
							size="xl"
							className="w-full"
							disabled={busy}
							onClick={() => void release()}
						>
							{busy ? (
								<>
									<Spinner /> {wallet.approvePrompt}
								</>
							) : (
								'Release accessory'
							)}
						</Button>
					) : (
						<>
							<Notice
								tone="info"
								title="Not the owner’s wallet"
								body={`Switch to ${linked} to release it.`}
							/>
							<Button
								variant="secondary"
								size="xl"
								className="w-full"
								onClick={() => setChoosing(true)}
							>
								Use a different wallet
							</Button>
						</>
					)}
				</>
			) : null}
		</ResponsiveSheet>
	);
}
