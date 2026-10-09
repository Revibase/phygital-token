<script lang="ts">
	import { cn } from '$lib/utils';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { accessoryMediaQuery } from '$lib/client/queries';

	type MarkState = 'idle' | 'waiting' | 'verified';
	let {
		state: mode = 'idle',
		size = 'lg',
		pda = null,
		hasMint,
		class: className = ''
	}: { state?: MarkState; size?: 'sm' | 'md' | 'lg' | 'xl'; pda?: string | null; hasMint?: boolean; class?: string } = $props();

	const box = { sm: 'size-12', md: 'size-20', lg: 'size-28', xl: 'size-28 lg:size-64' };
	const mark = { sm: 'w-6', md: 'w-10', lg: 'w-14', xl: 'w-14 lg:w-28' };

	const wantsMedia = $derived(!!pda && hasMint !== false);
	const media = createQuery(() => ({ ...accessoryMediaQuery(pda ?? ''), enabled: wantsMedia }));
	const image = $derived(media.data?.image ?? null);
	const resolved = $derived(!wantsMedia || media.isSuccess || media.isError);

	// Tracked per image URL, so a new image starts unloaded without an effect racing the browser's load event.
	let loadedSrc = $state<string | null>(null);
	let failedSrc = $state<string | null>(null);
	const loaded = $derived(!!image && loadedSrc === image);
	const failed = $derived(!!image && failedSrc === image);

	const showArtwork = $derived(!!image && !failed);
	const showPlaceholder = $derived(hasMint === true && (!resolved || (showArtwork && !loaded)));
</script>

<div class={cn('relative grid shrink-0 place-items-center', box[size], className)} aria-hidden="true">
	{#if mode === 'waiting'}
		<span class="animate-ripple absolute inset-0 rounded-[26%] ring-2 ring-brand/60"></span>
	{/if}
	<div
		class={cn(
			'relative grid size-full place-items-center overflow-hidden rounded-[26%] transition-colors duration-200 ease-out',
			showPlaceholder || (showArtwork && loaded)
				? 'bg-muted'
				: 'bg-brand bg-[linear-gradient(160deg,rgb(255_255_255/0.16),transparent_55%)] text-brand-cream',
			'shadow-[0_1px_1px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(14_26_26/0.35),inset_0_1px_0_rgb(255_255_255/0.28)]'
		)}
	>
		{#if !showPlaceholder && !(showArtwork && loaded)}
			<RevibaseMark class={cn(mark[size], resolved && hasMint === true && 'animate-rise')} />
		{/if}
		{#if showArtwork}
			<img
				src={image}
				alt=""
				decoding="async"
				referrerpolicy="no-referrer"
				class={cn('absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out', loaded ? 'opacity-100' : 'opacity-0')}
				onload={() => (loadedSrc = image)}
				onerror={() => (failedSrc = image)}
			/>
			<span class="pointer-events-none absolute inset-0 rounded-[26%] ring-1 ring-black/5 ring-inset"></span>
		{/if}
	</div>
	{#if mode === 'verified'}
		<span
			class={cn(
				'animate-pop absolute grid place-items-center rounded-full bg-success text-white ring-[3px] ring-background',
				size === 'sm' ? '-right-1 -bottom-1 size-5' : size === 'xl' ? '-right-1.5 -bottom-1.5 size-7 lg:-right-2.5 lg:-bottom-2.5 lg:size-11' : '-right-1.5 -bottom-1.5 size-7'
			)}
		>
			<svg viewBox="0 0 24 24" class={size === 'sm' ? 'size-3' : size === 'xl' ? 'size-4 lg:size-6' : 'size-4'} fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
				<path class="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
			</svg>
		</span>
	{/if}
</div>
