<script lang="ts">
	import type { Snippet } from 'svelte';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';

	let { children, footer }: { children: Snippet; footer?: Snippet } = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
	<header class="flex h-12 items-center">
		<a href="/" class="-mx-2 inline-flex h-11 items-center gap-2 px-2" aria-label="Revibase home">
			<span class="grid size-7 place-items-center rounded-[28%] bg-brand text-brand-cream">
				<RevibaseMark class="w-4" />
			</span>
			<span class="text-[15px] font-semibold tracking-tight">Revibase</span>
		</a>
	</header>
	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
	{#if footer}<footer class="pt-6">{@render footer()}</footer>{/if}
</div>
