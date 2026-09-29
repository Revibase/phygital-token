<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

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
		align?: 'start' | 'center' | 'center-mobile';
		eyebrowTone?: 'muted' | 'success';
		children?: Snippet;
	} = $props();
</script>

<div class={cn('space-y-2', align === 'center' && 'text-center', align === 'center-mobile' && 'text-center lg:text-left')}>
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
				align === 'center' && 'flex items-center justify-center gap-1.5',
				align === 'center-mobile' && 'flex items-center justify-center gap-1.5 lg:justify-start'
			)}
		>
			{eyebrow}
		</p>
	{/if}
	<h1 class="text-[26px] leading-[1.15] font-semibold tracking-[-0.022em]">{title}</h1>
	{#if body}<p class="text-[15px] leading-relaxed text-muted-foreground">{body}</p>{/if}
	{@render children?.()}
</div>
