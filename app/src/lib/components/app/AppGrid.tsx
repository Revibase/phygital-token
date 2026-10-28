'use client';

import { useState } from 'react';

import { appDestination, type ProjectApp } from '#lib/shared/project-apps.ts';
import { AppLink } from './AppLink';

const tile =
	'group flex w-full flex-col items-center gap-1.5 rounded-[14px] px-1 pt-1 pb-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const icon =
	'grid size-14 place-items-center overflow-hidden rounded-[16px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),inset_0_-1px_0_rgb(0_0_0/0.08),0_1px_2px_rgb(14_26_26/0.12),0_8px_18px_-10px_rgb(14_26_26/0.45)] transition-transform duration-150 ease-out group-active:scale-[0.94]';

export function AppGrid({
	items,
	accent = null,
	onEmbed
}: {
	items: ProjectApp[];
	/** Tiles without an icon show the app's initial on this, so they read as the project's, not as placeholders. */
	accent?: { color: string; foreground: string } | null;
	onEmbed: (item: ProjectApp) => void;
}) {
	const [broken, setBroken] = useState<Set<string>>(new Set());

	return (
		<ul className="grid grid-cols-4 gap-x-2 gap-y-4">
			{items.map((item) => {
				const title = `${item.label} · ${appDestination(item)}`;
				const body =
					item.icon && !broken.has(item.icon) ? (
						<span className={`${icon} bg-card`}>
							<img
								src={item.icon}
								alt=""
								className="size-full object-cover"
								decoding="async"
								onError={() => setBroken((current) => new Set(current).add(item.icon!))}
							/>
						</span>
					) : (
						<span
							className={`${icon} ${accent ? '' : 'bg-linear-to-br from-[#64748B] to-[#334155]'}`}
							style={
								accent ? { backgroundColor: accent.color, color: accent.foreground } : undefined
							}
						>
							<span className="text-[22px] leading-none font-semibold">
								{Array.from(item.label)[0]?.toUpperCase()}
							</span>
						</span>
					);
				const caption = (
					<span className="line-clamp-2 text-[12px] leading-tight font-medium">{item.label}</span>
				);
				return (
					<li key={item.label + item.href}>
						<AppLink app={item} onEmbed={onEmbed} className={tile} title={title}>
							{body}
							{caption}
						</AppLink>
					</li>
				);
			})}
		</ul>
	);
}
