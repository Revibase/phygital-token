<script lang="ts">
	import { cn } from '$lib/utils';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';
	import { accessoryMedia } from '$lib/client/media';

	/**
	 * The physical accessory. Shows its collectible artwork when it has a bound
	 * mint; otherwise the Revibase tile.
	 * - waiting:  one soft ring — the only looping motion in the app, shown only
	 *             while we wait for a physical tap.
	 * - verified: the check badge pops in once (confirmation), then stays.
	 *
	 * `hasMint`: true → never flash our logo; hold a neutral tile until the
	 * artwork loads (200ms fade-in), falling back to the logo if there is none.
	 * undefined (unknown) → start with the logo and fade to artwork if found.
	 * Decorative: the surrounding text carries the meaning.
	 */
	type MarkState = 'idle' | 'waiting' | 'verified';
	let {
		state: mode = 'idle',
		size = 'lg',
		pda = null,
		hasMint,
		class: className = ''
	}: { state?: MarkState; size?: 'sm' | 'md' | 'lg'; pda?: string | null; hasMint?: boolean; class?: string } = $props();

	const box = { sm: 'size-12', md: 'size-20', lg: 'size-28' };
	const mark = { sm: 'w-6', md: 'w-10', lg: 'w-14' };

	let image = $state<string | null>(null);
	let resolved = $state(false);
	let loaded = $state(false);
	let failed = $state(false);

	$effect(() => {
		image = null;
		resolved = false;
		loaded = false;
		failed = false;
		if (!pda || hasMint === false) {
			resolved = true;
			return;
		}
		let alive = true;
		void accessoryMedia(pda).then((m) => {
			if (!alive) return;
			image = m.image;
			resolved = true;
		});
		return () => {
			alive = false;
		};
	});

	const showArtwork = $derived(!!image && !failed);
	/** Neutral tile while we know artwork is coming (until it has painted); never our logo. */
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
				onload={() => (loaded = true)}
				onerror={() => (failed = true)}
			/>
			<!-- Hairline inner edge so light artwork doesn't bleed into the background. -->
			<span class="pointer-events-none absolute inset-0 rounded-[26%] ring-1 ring-black/5 ring-inset"></span>
		{/if}
	</div>
	{#if mode === 'verified'}
		<span
			class={cn(
				'animate-pop absolute grid place-items-center rounded-full bg-success text-white ring-[3px] ring-background',
				size === 'sm' ? '-right-1 -bottom-1 size-5' : '-right-1.5 -bottom-1.5 size-7'
			)}
		>
			<svg viewBox="0 0 24 24" class={size === 'sm' ? 'size-3' : 'size-4'} fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
				<path class="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
			</svg>
		</span>
	{/if}
</div>
