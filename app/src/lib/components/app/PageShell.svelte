<script lang="ts">
	import type { Snippet } from 'svelte';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';

	/**
	 * Stable frame for every screen: header never moves; content column is
	 * 440px max; actions sit in the thumb zone above the safe area.
	 */
	let { children, footer }: { children: Snippet; footer?: Snippet } = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
	<header class="flex h-12 items-center">
		<a href="/" class="-mx-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none" aria-label="Revibase home">
			<span class="grid size-6 place-items-center rounded-[26%] bg-brand text-brand-cream">
				<RevibaseMark class="w-3.5" />
			</span>
			<span class="text-[15px] font-semibold tracking-[-0.01em]">Revibase</span>
		</a>
	</header>
	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
	{#if footer}<footer class="pt-6">{@render footer()}</footer>{/if}
</div>
