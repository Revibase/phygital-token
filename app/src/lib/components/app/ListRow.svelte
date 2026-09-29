<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import { Spinner } from '$lib/components/ui/spinner';

	let {
		label,
		detail,
		href,
		onclick,
		external = false,
		chevron = false,
		busy = false,
		disabled = false,
		tone = 'default',
		leading,
		trailing,
		rel
	}: {
		label: string;
		detail?: string;
		href?: string;
		onclick?: () => void;
		external?: boolean;
		chevron?: boolean;
		busy?: boolean;
		disabled?: boolean;
		tone?: 'default' | 'destructive';
		leading?: Snippet;
		trailing?: Snippet;
		rel?: string;
	} = $props();

	const interactive = $derived(!!href || !!onclick);
	const classes = $derived(
		cn(
			'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none',
			interactive &&
				'transition-colors duration-150 ease-out hover:bg-muted/60 active:bg-muted focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
			(disabled || busy) && 'pointer-events-none',
			disabled && 'opacity-50'
		)
	);
</script>

{#snippet content()}
	{#if leading}<span class="grid shrink-0 place-items-center">{@render leading()}</span>{/if}
	<span class="min-w-0 flex-1">
		<span class={cn('block truncate text-[15px] font-medium', tone === 'destructive' && 'text-destructive')}>{label}</span>
		{#if detail}<span class="block truncate text-[13px] text-muted-foreground">{detail}</span>{/if}
	</span>
	{#if busy}
		<Spinner class="size-4 text-muted-foreground" />
	{:else if trailing}
		{@render trailing()}
	{:else if external}
		<ArrowUpRightIcon class="size-4 text-muted-foreground" />
	{:else if chevron}
		<ChevronRightIcon class="size-4 text-muted-foreground/70" />
	{/if}
{/snippet}

<li>
	{#if href}
		<a {href} {rel} class={classes} aria-disabled={disabled || undefined}>{@render content()}</a>
	{:else if onclick}
		<button type="button" class={classes} {disabled} aria-busy={busy || undefined} onclick={onclick}>{@render content()}</button>
	{:else}
		<div class={classes}>{@render content()}</div>
	{/if}
</li>
