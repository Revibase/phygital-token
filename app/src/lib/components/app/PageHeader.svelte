<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	/**
	 * One heading pattern for every screen: optional eyebrow (status or step),
	 * title, one line of supporting copy. `step` renders a two-segment progress
	 * bar so multi-step flows show where you are without a numbered list.
	 */
	let {
		title,
		eyebrow,
		body,
		step,
		align = 'start',
		eyebrowTone = 'muted',
		children
	}: {
		title: string;
		eyebrow?: string;
		body?: string;
		step?: { current: number; total: number };
		align?: 'start' | 'center';
		eyebrowTone?: 'muted' | 'success';
		children?: Snippet;
	} = $props();
</script>

<div class={cn('space-y-2', align === 'center' && 'text-center')}>
	{#if step}
		<div class="mb-4 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={step.total} aria-valuenow={step.current} aria-label={`Step ${step.current} of ${step.total}`}>
			{#each Array.from({ length: step.total }, (_, i) => i) as i (i)}
				<span
					class={cn(
						'h-1 flex-1 rounded-full transition-colors duration-300 ease-out',
						i < step.current ? 'bg-primary' : 'bg-border'
					)}
				></span>
			{/each}
		</div>
	{/if}
	{#if eyebrow}
		<p
			class={cn(
				'text-[13px] font-medium tracking-[-0.005em]',
				eyebrowTone === 'success' ? 'text-success' : 'text-muted-foreground',
				align === 'center' && 'flex items-center justify-center gap-1.5'
			)}
		>
			{eyebrow}
		</p>
	{/if}
	<h1 class="text-[26px] leading-[1.15] font-semibold tracking-[-0.022em]">{title}</h1>
	{#if body}<p class="text-[15px] leading-relaxed text-muted-foreground">{body}</p>{/if}
	{@render children?.()}
</div>
