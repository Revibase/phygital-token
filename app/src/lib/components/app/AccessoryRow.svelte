<script lang="ts">
	import type { Snippet } from 'svelte';
	import AccessoryMark from './AccessoryMark.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery } from '$lib/client/queries';
	import type { AccessoryView } from '$lib/shared/types';
	import { cn } from '$lib/utils';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		accessory,
		onclick,
		trailing,
		busy = false
	}: {
		accessory: AccessoryView;
		onclick?: () => void;
		trailing?: Snippet;
		busy?: boolean;
	} = $props();

	const media = createQuery(() => ({ ...accessoryMediaQuery(accessory.pda), enabled: !!accessory.mint }));
	const name = $derived(media.data?.name ?? null);

	const kind = $derived(
		accessory.kind === 'permanent'
			? 'Bound to this wallet'
			: accessory.kind === 'controlled' || accessory.isLocked
				? 'Locked to this wallet'
				: 'Tradable'
	);
</script>

<li class="flex min-h-14 w-full items-stretch">
	<button
		type="button"
		class={cn(
			'flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left outline-none',
			'transition-colors duration-150 ease-out hover:bg-muted/60 active:bg-muted focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
			busy && 'pointer-events-none opacity-60'
		)}
		disabled={busy}
		aria-busy={busy || undefined}
		{onclick}
	>
		<span class="grid shrink-0 place-items-center"><AccessoryMark size="sm" pda={accessory.pda} hasMint={!!accessory.mint} /></span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-[15px] font-medium">{name ?? `Accessory · ${accessory.tag}`}</span>
			<span class="block truncate text-[13px] text-muted-foreground">{name ? `${kind} · ${accessory.tag}` : kind}</span>
		</span>
		{#if onclick && !trailing}
			<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground/70" />
		{/if}
	</button>
	{#if trailing}
		<span class="flex shrink-0 items-center gap-1 pr-3">{@render trailing()}</span>
	{/if}
</li>
