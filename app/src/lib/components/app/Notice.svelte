<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import InfoIcon from '@lucide/svelte/icons/info';

	/**
	 * Inline message. Calm by default (no border, soft tint), enters with a
	 * 240ms rise so a new error is noticed without a jolt. Technical detail is
	 * one tap away, never in the main copy.
	 */
	let {
		title,
		body,
		detail,
		tone = 'error',
		actions
	}: { title: string; body?: string; detail?: string; tone?: 'error' | 'info'; actions?: Snippet } = $props();
	let showDetail = $state(false);
</script>

<div class="animate-rise space-y-3" role={tone === 'error' ? 'alert' : 'status'}>
	<div class={cn('flex gap-3 rounded-[14px] px-4 py-3.5', tone === 'error' ? 'bg-destructive/[0.07]' : 'bg-muted')}>
		{#if tone === 'error'}
			<CircleAlertIcon class="mt-0.5 size-[18px] shrink-0 text-destructive" />
		{:else}
			<InfoIcon class="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
		{/if}
		<div class="min-w-0 space-y-0.5">
			<p class="text-[15px] font-medium">{title}</p>
			{#if body}<p class="text-[14px] leading-snug text-muted-foreground">{body}</p>{/if}
			{#if detail}
				<button
					type="button"
					class="-ml-1 mt-1 min-h-8 rounded px-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
					aria-expanded={showDetail}
					onclick={() => (showDetail = !showDetail)}
				>
					{showDetail ? 'Hide details' : 'Details'}
				</button>
				{#if showDetail}<pre class="animate-rise mt-1 overflow-x-auto text-[12px] whitespace-pre-wrap text-muted-foreground">{detail}</pre>{/if}
			{/if}
		</div>
	</div>
	{#if actions}<div class="grid gap-2">{@render actions()}</div>{/if}
</div>
