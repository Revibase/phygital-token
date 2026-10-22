'use client';

import { Wallet } from 'lucide-react';

import { cn } from '#lib/utils.ts';

/** Always the generic mark: wallets are shown by address, never by the app that connected them. */
export function WalletAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				'grid place-items-center rounded-[9px] bg-muted text-muted-foreground',
				size === 'sm' ? 'size-7' : 'size-9'
			)}
		>
			<Wallet className={size === 'sm' ? 'size-3.5' : 'size-4'} />
		</span>
	);
}
