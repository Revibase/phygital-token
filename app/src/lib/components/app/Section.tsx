'use client';

import { cn } from '#lib/utils.ts';

/** A labelled group of content, aligned with `List` cards. */
export function Section({
	children,
	label,
	footer,
	className = ''
}: {
	children: React.ReactNode;
	label?: string;
	footer?: string;
	className?: string;
}) {
	return (
		<section className={cn('space-y-2', className)} aria-label={label}>
			{label ? (
				<h2 className="px-1 text-[13px] font-medium text-muted-foreground">{label}</h2>
			) : null}
			{children}
			{footer ? (
				<p className="px-1 text-[13px] leading-snug text-muted-foreground">{footer}</p>
			) : null}
		</section>
	);
}
