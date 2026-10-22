'use client';

import { shortAddress } from '#lib/shared/encoding.ts';
import { WalletAvatar } from './WalletAvatar';

export function WalletAccount({
	address,
	label,
	onClick
}: {
	address: string;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={`${label}, ${address}. Show address`}
			onClick={onClick}
			className="mx-auto inline-flex h-11 max-w-full items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-muted"
		>
			<WalletAvatar size="sm" />
			<span className="font-mono text-[14px] font-medium">{shortAddress(address)}</span>
		</button>
	);
}
