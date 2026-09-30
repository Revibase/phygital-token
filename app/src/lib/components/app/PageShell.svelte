<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';

	/**
	 * Stable frame for every screen. Phone: one 440px column, header never
	 * moves, actions sit in the thumb zone above the safe area.
	 * Desktop (lg+): a full-width toolbar with a hairline, and the content
	 * centred in the window at `size` — actions follow the content instead of
	 * sitting at the bottom of a tall window.
	 *
	 * - narrow: 440px, single-purpose flows (linking, tap results)
	 * - medium: 560px, lists (home)
	 * - wide:   920px, two-pane screens (the accessory)
	 */
	let {
		children,
		footer,
		size = 'narrow'
	}: { children: Snippet; footer?: Snippet; size?: 'narrow' | 'medium' | 'wide' } = $props();

	// Wallet users check the network before they sign; only a non-mainnet one needs saying.
	const cluster = $derived((page.data as { cluster?: string }).cluster);
	const network = $derived(cluster && cluster !== 'mainnet' ? cluster.charAt(0).toUpperCase() + cluster.slice(1) : null);

	const max = { narrow: 'lg:max-w-[440px]', medium: 'lg:max-w-[560px]', wide: 'lg:max-w-[920px]' };
</script>

<div class="flex min-h-dvh w-full flex-col">
	<header class="pt-[max(0.75rem,env(safe-area-inset-top))] lg:border-b lg:border-border/70 lg:pt-0">
		<div class="mx-auto flex h-12 w-full max-w-[440px] items-center justify-between px-5 lg:h-14 lg:max-w-none lg:px-8">
			<a href="/" class="-mx-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none" aria-label="Revibase home">
				<span class="grid size-6 place-items-center rounded-[26%] bg-brand text-brand-cream">
					<RevibaseMark class="w-3.5" />
				</span>
				<span class="text-[15px] font-semibold tracking-[-0.01em]">Revibase</span>
			</a>
			{#if network}
				<span class="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground" title="Solana network">{network}</span>
			{/if}
		</div>
	</header>
	<div class="flex flex-1 flex-col lg:justify-center">
		<div class="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:flex-none lg:px-8 lg:py-12 {max[size]}">
			<main class="flex flex-1 flex-col">
				{@render children()}
			</main>
			{#if footer}<footer class="pt-6">{@render footer()}</footer>{/if}
		</div>
	</div>
</div>
