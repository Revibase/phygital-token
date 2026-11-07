'use client';

import { ChevronRight } from 'lucide-react';

import type { AccessoryView } from '#lib/shared/types.ts';
import { cn } from '#lib/utils.ts';
import { AccessoryMark } from './AccessoryMark';

export function AccessoryRow({
	accessory,
	onClick,
	trailing,
	busy = false
}: {
	accessory: AccessoryView;
	onClick?: () => void;
	trailing?: React.ReactNode;
	busy?: boolean;
}) {
	const detail = accessory.kind === 'permanent' ? 'Permanent' : '';

	return (
		<li className="flex min-h-14 w-full items-stretch">
			<button
				type="button"
				className={cn(
					'flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left outline-none',
					'transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset active:bg-muted',
					busy && 'pointer-events-none opacity-60'
				)}
				disabled={busy}
				aria-busy={busy || undefined}
				onClick={onClick}
			>
				<span className="grid shrink-0 place-items-center">
					<AccessoryMark size="sm" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-[15px] font-medium">Accessory {accessory.tag}</span>
					{detail ? (
						<span className="block truncate text-[13px] text-muted-foreground">{detail}</span>
					) : null}
				</span>
				{onClick && !trailing ? (
					<ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
				) : null}
			</button>
			{trailing ? <span className="flex shrink-0 items-center gap-1 pr-3">{trailing}</span> : null}
		</li>
	);
}
