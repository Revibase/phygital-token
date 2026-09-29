<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	/** A grouped list: one quiet surface with hairline dividers — never cards inside cards. */
	let { children, label, footer, class: className = '' }: { children: Snippet; label?: string; footer?: string; class?: string } = $props();
</script>

<section class={cn('space-y-2', className)} aria-label={label}>
	{#if label}<h2 class="px-1 text-[13px] font-medium text-muted-foreground">{label}</h2>{/if}
	<ul class="divide-y divide-border/80 overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_rgb(14_26_26/0.05),0_1px_2px_rgb(14_26_26/0.04)]">
		{@render children()}
	</ul>
	{#if footer}<p class="px-1 text-[13px] leading-snug text-muted-foreground">{footer}</p>{/if}
</section>
