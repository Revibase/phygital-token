'use client';

import { CircleCheck, Copy } from 'lucide-react';

import { copyText } from '#lib/client/clipboard.ts';
import { buttonVariants } from '#lib/components/ui/button';
import { shortAddress } from '#lib/shared/encoding.ts';
import { ListRow } from './ListRow';
import { WalletAvatar } from './WalletAvatar';

export function WalletRow({
	address,
	label,
	context = null,
	nftOwnership = null,
	href,
	value
}: {
	address: string;
	label?: string;
	context?: string | null;
	nftOwnership?: 'same' | 'different' | null;
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
			labelBadge={
				nftOwnership ? (
					<span
						className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
							nftOwnership === 'same'
								? 'bg-success/10 text-success'
								: 'bg-muted text-muted-foreground'
						}`}
					>
						{nftOwnership === 'same' ? (
							<>
								<CircleCheck className="size-3 shrink-0" />
								Owns NFT
							</>
						) : (
							'NFT held elsewhere'
						)}
					</span>
				) : null
			}
			leading={<WalletAvatar />}
		/>
	);
}
