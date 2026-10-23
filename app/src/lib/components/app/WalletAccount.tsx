'use client';

import { useEffect, useState } from 'react';

import { copyText } from '#lib/client/clipboard.ts';
import { shortAddress } from '#lib/shared/encoding.ts';
import { WalletAvatar } from './WalletAvatar';

export function WalletAccount({ address, label }: { address: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<button
			type="button"
			aria-label={copied ? 'Copied' : `Copy ${label} address`}
			onClick={() => {
				void copyText(address, 'Address copied').then((ok) => {
					if (ok) setCopied(true);
				});
			}}
			className="mx-auto inline-flex h-11 max-w-full items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-muted"
		>
			<WalletAvatar size="sm" />
			<span className="font-mono text-[14px] font-medium">
				{copied ? 'Copied' : shortAddress(address)}
			</span>
		</button>
	);
}
