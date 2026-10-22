'use client';

import { networkLabel } from '#lib/shared/explorer.ts';
import { CopyField } from './CopyField';
import { QrCode } from './QrCode';
import { ResponsiveSheet } from './ResponsiveSheet';

export function ReceiveSheet({
	open,
	onOpenChange,
	address,
	cluster,
	description = 'Only send SOL and Solana tokens to this address.'
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	address: string;
	cluster?: string;
	description?: string;
}) {
	const network = cluster ? networkLabel(cluster) : null;
	return (
		<ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Your address" description={description}>
			<div className="space-y-5">
				{network ? <p className="text-center text-[13px] font-medium text-muted-foreground">On {network}</p> : null}
				<QrCode value={`solana:${address}`} accessibleLabel="Wallet address QR code" label="Scan with any Solana wallet." />
				<CopyField value={address} label="Copy address" mono />
			</div>
		</ResponsiveSheet>
	);
}
