<script lang="ts">
	import type { ShortcutLaunch } from '$lib/client/shortcuts';
	import { shortcutDestination, type Shortcut, type ShortcutIcon as IconName } from '$lib/shared/shortcuts';
	import { SvelteSet } from 'svelte/reactivity';
	import ShortcutIcon from './ShortcutIcon.svelte';

	let {
		label,
		items,
		onpick
	}: {
		label: string;
		items: Array<{ s: Shortcut; index: number; launch: ShortcutLaunch }>;
		onpick: (item: { s: Shortcut; index: number; launch: ShortcutLaunch }) => void;
	} = $props();

	const tile =
		'group flex w-full flex-col items-center gap-1.5 rounded-[14px] px-1 pt-1 pb-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
	const icon =
		'grid size-14 place-items-center overflow-hidden rounded-[16px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),inset_0_-1px_0_rgb(0_0_0/0.08),0_1px_2px_rgb(14_26_26/0.12),0_8px_18px_-10px_rgb(14_26_26/0.45)] transition-transform duration-150 ease-out group-active:scale-[0.94]';

	/** Every fill keeps the white glyph at 3:1 or better. Full class strings, so Tailwind sees them. */
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

	const broken = new SvelteSet<string>();
</script>

<section class="space-y-3" aria-label={label}>
	<h2 class="px-1 text-[13px] font-medium text-muted-foreground">{label}</h2>
	<ul class="grid grid-cols-4 gap-x-2 gap-y-4">
		{#each items as item (item.s.label + item.s.href)}
			{@const { s, launch } = item}
			{@const title = `${s.label} · ${shortcutDestination(s)}`}
			<li>
				{#snippet body()}
					{#if s.image && !broken.has(s.image)}
						<span class="{icon} bg-card"><img src={s.image} alt="" class="size-full object-cover" decoding="async" onerror={() => broken.add(s.image!)} /></span>
					{:else}
						<span class="{icon} {themes[s.icon] ?? themes['generic-link']}"><ShortcutIcon icon={s.icon} class="size-6 drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]" /></span>
					{/if}
					<span class="line-clamp-2 text-[12px] leading-tight font-medium">{s.label}</span>
				{/snippet}
				{#if launch.kind === 'link'}
					<!-- Our own paths are server routes or need their own headers: always a full page load. -->
					<a href={launch.href} target={launch.newTab ? '_blank' : undefined} rel="noopener noreferrer" data-sveltekit-reload={launch.href.startsWith('/') || undefined} class={tile} {title}>{@render body()}</a>
				{:else}
					<button type="button" class={tile} {title} onclick={() => onpick(item)}>{@render body()}</button>
				{/if}
			</li>
		{/each}
	</ul>
</section>
