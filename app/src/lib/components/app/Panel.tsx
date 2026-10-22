'use client';

import { cn } from '#lib/utils.ts';

/** The app's one muted surface: grouped controls, notes, copy fields and empty states. */
export function Panel({
	children,
	tone = 'muted',
	element: Element = 'div',
	className = ''
}: {
	children: React.ReactNode;
	tone?: 'muted' | 'tint';
	element?: 'div' | 'li' | 'label' | 'blockquote';
	className?: string;
}) {
	return (
		<Element
			className={cn(
				'rounded-[14px] px-4 py-3',
				tone === 'tint' ? 'bg-primary/5' : 'bg-muted',
				className
			)}
		>
			{children}
		</Element>
	);
}
