'use client';

import { Copy } from 'lucide-react';

import { copyText } from '#lib/client/clipboard.ts';
import { buttonVariants } from '#lib/components/ui/button';
import { shortAddress } from '#lib/shared/encoding.ts';
import { ListRow } from './ListRow';
import { WalletAvatar } from './WalletAvatar';

export function WalletRow({
	address,
	label,
	context = null,
	href,
	value
}: {
	address: string;
	label?: string;
	context?: string | null;
	href?: string;
	value?: string;
}) {
	return (
		<ListRow
			label={label ?? shortAddress(address)}
			detail={label ? shortAddress(address) : undefined}
			subdetail={context ?? undefined}
			href={href}
			value={value}
			chevron={!!href}
			trailing={
				href ? undefined : (
					<button
						type="button"
						aria-label="Copy wallet address"
						className={buttonVariants({ variant: 'ghost', size: 'icon' })}
						onClick={() => void copyText(address, 'Wallet address copied')}
					>
						<Copy className="size-4" />
					</button>
				)
			}
			leading={<WalletAvatar />}
		/>
	);
}
