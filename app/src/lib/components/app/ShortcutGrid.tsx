'use client';

import { useState } from 'react';

import { shortcutDestination, type Shortcut, type ShortcutIcon as IconName } from '#lib/shared/shortcuts.ts';
import { Section } from './Section';
import { ShortcutIcon } from './ShortcutIcon';
import { SolanaPaySheet } from './SolanaPaySheet';

const tile =
	'group flex w-full flex-col items-center gap-1.5 rounded-[14px] px-1 pt-1 pb-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const icon =
	'grid size-14 place-items-center overflow-hidden rounded-[16px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),inset_0_-1px_0_rgb(0_0_0/0.08),0_1px_2px_rgb(14_26_26/0.12),0_8px_18px_-10px_rgb(14_26_26/0.45)] transition-transform duration-150 ease-out group-active:scale-[0.94]';

const themes: Record<IconName, string> = {
	vote: 'bg-linear-to-br from-[#6366F1] to-[#4338CA]',
	'vote-2': 'bg-linear-to-br from-[#8B5CF6] to-[#6D28D9]',
	stake: 'bg-linear-to-br from-[#059669] to-[#065F46]',
	'stake-2': 'bg-linear-to-br from-[#0D9488] to-[#115E59]',
	view: 'bg-linear-to-br from-[#0284C7] to-[#075985]',
	chat: 'bg-linear-to-br from-[#16A34A] to-[#166534]',
	tip: 'bg-linear-to-br from-[#D97706] to-[#92400E]',
	mint: 'bg-linear-to-br from-[#C026D3] to-[#86198F]',
	'mint-2': 'bg-linear-to-br from-[#DB2777] to-[#9D174D]',
	discord: 'bg-linear-to-br from-[#7983F5] to-[#4752C4]',
	twitter: 'bg-linear-to-br from-[#1A8CD8] to-[#0B5E94]',
	x: 'bg-linear-to-br from-[#3F3F46] to-[#09090B]',
	instagram: 'bg-linear-to-tr from-[#D9480F] via-[#C13584] to-[#833AB4]',
	telegram: 'bg-linear-to-br from-[#1D8FCB] to-[#17699A]',
	leaderboard: 'bg-linear-to-br from-[#B8860B] to-[#854D0E]',
	gaming: 'bg-linear-to-br from-[#F43F5E] to-[#9F1239]',
	'gaming-2': 'bg-linear-to-br from-[#E11D48] to-[#6D28D9]',
	'generic-link': 'bg-linear-to-br from-[#64748B] to-[#334155]',
	'generic-add': 'bg-linear-to-br from-[#00968D] to-[#00625C]'
};

export function ShortcutGrid({
	label,
	items,
	onEmbed
}: {
	label: string;
	items: Shortcut[];
	onEmbed: (item: Shortcut) => void;
}) {
	const [broken, setBroken] = useState<Set<string>>(new Set());
	const [payment, setPayment] = useState<{ href: string; label: string } | null>(null);
	const [paymentOpen, setPaymentOpen] = useState(false);

	return (
		<>
			<Section label={label}>
				<ul className="grid grid-cols-4 gap-x-2 gap-y-4">
					{items.map((item) => {
						const title = `${item.label} · ${shortcutDestination(item)}`;
						const body =
							item.image && !broken.has(item.image) ? (
								<span className={`${icon} bg-card`}>
									<img
										src={item.image}
										alt=""
										className="size-full object-cover"
										decoding="async"
										onError={() =>
											setBroken((current) => new Set(current).add(item.image!))
										}
									/>
								</span>
							) : (
								<span className={`${icon} ${themes[item.icon] ?? themes['generic-link']}`}>
									<ShortcutIcon icon={item.icon} className="size-6 drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]" />
								</span>
							);
						const caption = <span className="line-clamp-2 text-[12px] leading-tight font-medium">{item.label}</span>;
						return (
							<li key={item.label + item.href}>
								{item.href.startsWith('solana:') ? (
									<button
										type="button"
										className={tile}
										title={title}
										onClick={() => {
											setPayment({ href: item.href, label: item.label });
											setPaymentOpen(true);
										}}
									>
										{body}
										{caption}
									</button>
								) : item.open === 'embed' ? (
									<button type="button" className={tile} title={title} onClick={() => onEmbed(item)}>
										{body}
										{caption}
									</button>
								) : (
									<a href={item.href} target="_blank" rel="noopener noreferrer" className={tile} title={title}>
										{body}
										{caption}
									</a>
								)}
							</li>
						);
					})}
				</ul>
			</Section>
			{payment ? (
				<SolanaPaySheet open={paymentOpen} onOpenChange={setPaymentOpen} href={payment.href} label={payment.label} />
			) : null}
		</>
	);
}
