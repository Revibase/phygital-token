<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children, footer }: { children: Snippet; footer?: Snippet } = $props();
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
	<header class="flex h-12 items-center">
		<a href="/" class="-mx-2 inline-flex h-11 items-center px-2 text-sm font-semibold tracking-tight">phygital</a>
	</header>
	<main class="flex flex-1 flex-col">
		{@render children()}
	</main>
	{#if footer}<footer class="pt-6">{@render footer()}</footer>{/if}
</div>
