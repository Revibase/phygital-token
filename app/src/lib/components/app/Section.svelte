<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	/** A labelled group of content, aligned with `List` cards. */
	let {
		children,
		label,
		footer,
		class: className = ''
	}: { children: Snippet; label?: string; footer?: string; class?: string } = $props();
</script>

<section class={cn('space-y-2', className)} aria-label={label}>
	{#if label}<h2 class="px-1 text-[13px] font-medium text-muted-foreground">{label}</h2>{/if}
	{@render children()}
	{#if footer}<p class="px-1 text-[13px] leading-snug text-muted-foreground">{footer}</p>{/if}
</section>
