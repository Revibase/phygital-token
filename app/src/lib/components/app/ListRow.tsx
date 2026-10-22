'use client';

import { ArrowUpRight, ChevronRight } from 'lucide-react';

import { Spinner } from '#lib/components/ui/spinner';
import { cn } from '#lib/utils.ts';

export function ListRow({
	label,
	detail,
	value,
	subdetail,
	href,
	onClick,
	external = false,
	chevron = false,
	busy = false,
	disabled = false,
	tone = 'default',
	labelBadge,
	leading,
	trailing,
	rel,
	target,
	selectable = false
}: {
	label: string;
	detail?: string;
	value?: string;
	subdetail?: string;
	href?: string;
	onClick?: () => void;
	external?: boolean;
	chevron?: boolean;
	busy?: boolean;
	disabled?: boolean;
	tone?: 'default' | 'destructive';
	labelBadge?: React.ReactNode;
	leading?: React.ReactNode;
	trailing?: React.ReactNode;
	rel?: string;
	target?: string;
	selectable?: boolean;
}) {
	const interactive = !!href || !!onClick || selectable;
	const classes = cn(
		'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none',
		interactive &&
			'transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset active:bg-muted',
		(disabled || busy) && 'pointer-events-none',
		disabled && 'opacity-50'
	);
	const content = (
		<>
			{leading ? <span className="grid shrink-0 place-items-center">{leading}</span> : null}
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span
						className={cn(
							'min-w-0 truncate text-[15px] font-medium',
							tone === 'destructive' && 'text-destructive'
						)}
					>
						{label}
					</span>
					{labelBadge}
				</span>
				{detail ? <span className="block truncate text-[13px] text-muted-foreground">{detail}</span> : null}
				{subdetail ? (
					<span className="block text-[12px] leading-snug text-muted-foreground">{subdetail}</span>
				) : null}
			</span>
			{value !== undefined ? (
				<span className="shrink-0 text-[15px] font-medium tabular-nums">{value}</span>
			) : null}
			{busy ? (
				<Spinner className="size-4 text-muted-foreground" />
			) : trailing ? (
				<>{trailing}</>
			) : external ? (
				<ArrowUpRight className="size-4 text-muted-foreground" />
			) : chevron ? (
				<ChevronRight className="size-4 text-muted-foreground/70" />
			) : null}
		</>
	);
	return (
		<li>
			{href ? (
				<a href={href} rel={rel} target={target} onClick={onClick} className={classes} aria-disabled={disabled || undefined}>
					{content}
				</a>
			) : onClick ? (
				<button type="button" className={classes} disabled={disabled} aria-busy={busy || undefined} onClick={onClick}>
					{content}
				</button>
			) : selectable ? (
				<label className={cn(classes, 'cursor-pointer')}>{content}</label>
			) : (
				<div className={classes}>{content}</div>
			)}
		</li>
	);
}
