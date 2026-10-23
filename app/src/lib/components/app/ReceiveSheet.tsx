'use client';

import { Download } from 'lucide-react';

import { Button } from '#lib/components/ui/button';
import { networkLabel } from '#lib/shared/explorer.ts';
import { CopyField } from './CopyField';
import { QrCode } from './QrCode';
import { ResponsiveSheet } from './ResponsiveSheet';

export function ReceiveSheet({
	open,
	onOpenChange,
	address,
	cluster,
	onBuy,
	buying = false,
	description = 'Only send SOL and Solana tokens to this address.'
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	address: string;
	cluster?: string;
	onBuy?: () => void;
	buying?: boolean;
	description?: string;
}) {
	const network = cluster ? networkLabel(cluster) : null;
	return (
		<ResponsiveSheet
			open={open}
			onOpenChange={onOpenChange}
			title="Your address"
			description={description}
		>
			<div className="space-y-5">
				{network ? (
					<p className="text-center text-[13px] font-medium text-muted-foreground">On {network}</p>
				) : null}
				<QrCode
					value={`solana:${address}`}
					accessibleLabel="Wallet address QR code"
					label="Scan with any Solana wallet."
				/>
				<CopyField value={address} label="Copy address" mono />
				{onBuy ? (
					<div className="space-y-3 border-t border-border/70 pt-5">
						<p className="text-center text-[13px] leading-snug text-muted-foreground">
							Or buy SOL with a card.
						</p>
						<Button size="xl" variant="secondary" disabled={buying} onClick={onBuy}>
							<Download className="size-4" />
							{buying ? 'Opening…' : 'Buy SOL'}
						</Button>
					</div>
				) : null}
			</div>
		</ResponsiveSheet>
	);
}
