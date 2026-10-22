'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { findPhygitalTokenPda, startAuthentication, verifyResponse } from 'phygital-token-sdk';
import { useEffect, useState } from 'react';

import { canTapHere, tapHint } from '#lib/client/capability.ts';
import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
import { accessoryMediaQuery } from '#lib/client/queries.ts';
import { browserRpc } from '#lib/client/rpc.ts';
import { shortAddress } from '#lib/shared/encoding.ts';
import type { AccessoryView } from '#lib/shared/types.ts';
import { CopyButton } from './CopyButton';
import { ExplorerLink } from './ExplorerLink';
import { List } from './List';
import { ListRow } from './ListRow';
import { Notice } from './Notice';
import { ResponsiveSheet } from './ResponsiveSheet';

const explorable = new Set(['Owner', 'NFT']);
const lower = (label: string) => (label === 'NFT' ? label : label.toLowerCase());
const kindLabel = {
	permanent: 'Permanent · its owner can’t change',
	bearer: 'Bearer · whoever holds it can claim it',
	controlled: 'Controlled · its owner releases it first',
	unknown: 'Unknown'
};

export function TechnicalDetails({
	accessory,
	cluster,
	open,
	onOpenChange
}: {
	accessory: AccessoryView;
	cluster: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const mediaQuery = useQuery({ ...accessoryMediaQuery(accessory.pda), enabled: !!accessory.mint });
	const collectibleName = mediaQuery.data?.name ?? null;
	const [check, setCheck] = useState<'idle' | 'tapping' | 'genuine' | 'mismatch'>('idle');
	const [checkFailure, setCheckFailure] = useState<FriendlyError | null>(null);
	const canCheck = canTapHere();
	useEffect(() => {
		if (open) {
			setCheck('idle');
			setCheckFailure(null);
		}
	}, [open]);
	const checkDetail = !canCheck
		? 'Open this page in Safari or Chrome'
		: {
				idle: 'Hold it to your phone',
				tapping: tapHint(),
				genuine: 'Genuine, and in your hand',
				mismatch: 'That’s a different accessory'
			}[check];

	async function runCheck() {
		setCheck('tapping');
		setCheckFailure(null);
		try {
			const message = crypto.randomUUID();
			const response = await startAuthentication(message, { rpc: browserRpc() });
			const result = await verifyResponse({
				expectedMessage: message,
				expectedOrigin: location.origin,
				response
			});
			if (!result.isVerified) throw new Error('Signature did not verify');
			setCheck(String(await findPhygitalTokenPda(result.secp256r1PublicKey)) === accessory.pda ? 'genuine' : 'mismatch');
		} catch (err) {
			setCheckFailure(describeError(err, 'tap'));
			setCheck('idle');
		}
	}

	const copyable = [
		['Public key', accessory.publicKey],
		['Owner', accessory.owner],
		['NFT', accessory.mint]
	] as const;

	return (
		<ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Accessory details">
			<List>
				<ListRow
					label="Check it’s genuine"
					detail={checkDetail}
					busy={check === 'tapping'}
					onClick={canCheck ? () => void runCheck() : undefined}
					trailing={
						check === 'genuine' ? (
							<Check className="animate-rise size-5 text-success" />
						) : canCheck ? (
							<ChevronRight className="size-4 text-muted-foreground/70" />
						) : null
					}
				/>
			</List>
			<Notice error={checkFailure} />
			<List>
				<ListRow label="Type" detail={kindLabel[accessory.kind]} />
				<ListRow label="Status" detail={accessory.isLocked ? 'Locked' : 'Unlocked'} />
			</List>
			<List>
				{copyable.map(([label, value]) => (
					<ListRow
						key={label}
						label={label}
						detail={
							value
								? label === 'NFT' && collectibleName
									? `${collectibleName} · ${shortAddress(value)}`
									: shortAddress(value)
								: 'None'
						}
						trailing={
							value ? (
								<span className="flex items-center">
									{explorable.has(label) ? (
										<ExplorerLink value={value} cluster={cluster} label={`View ${lower(label)} on Solana Explorer`} />
									) : null}
									<CopyButton value={value} label={`Copy ${lower(label)}`} />
								</span>
							) : null
						}
					/>
				))}
			</List>
		</ResponsiveSheet>
	);
}
