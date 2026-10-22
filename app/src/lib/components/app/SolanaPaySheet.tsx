'use client';

import { Copy, Wallet } from 'lucide-react';

import { copyText } from '#lib/client/clipboard.ts';
import { Button } from '#lib/components/ui/button';
import { QrCode } from './QrCode';
import { ResponsiveSheet } from './ResponsiveSheet';

export function SolanaPaySheet({
	open,
	onOpenChange,
	href,
	label
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	href: string;
	label: string;
}) {
	return (
		<ResponsiveSheet open={open} onOpenChange={onOpenChange} title={label} description="Solana Pay">
			<div className="space-y-5">
				<Button href={href} size="xl">
					<Wallet className="size-4" />
					Open in wallet
				</Button>
				<QrCode value={href} accessibleLabel="Solana Pay request QR code" label="Or scan with your wallet." />
				<Button
					variant="secondary"
					size="xl"
					onClick={() => void copyText(href, 'Payment link copied', 'Couldn’t copy payment link. Try again.')}
				>
					<Copy className="size-4" />
					Copy payment link
				</Button>
				<p className="text-center text-[13px] leading-relaxed text-muted-foreground">
					Wallet didn’t open? Use one that supports{' '}
					<a
						href="https://docs.solanapay.com/"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-primary underline underline-offset-4"
					>
						Solana Pay
					</a>
					.
				</p>
			</div>
		</ResponsiveSheet>
	);
}
