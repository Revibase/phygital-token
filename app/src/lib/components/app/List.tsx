'use client';

import { Section } from './Section';

export function List({
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
		<Section label={label} footer={footer} className={className}>
			<ul className="divide-border/80 divide-y overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_rgb(14_26_26/0.05),0_1px_2px_rgb(14_26_26/0.04)]">
				{children}
			</ul>
		</Section>
	);
}
