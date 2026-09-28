<script lang="ts">
	import { cn } from '$lib/utils';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';

	/**
	 * The physical accessory, drawn as the Revibase tile.
	 * - waiting:  one soft ring — the only looping motion in the app, shown only
	 *             while we wait for a physical tap.
	 * - verified: the check badge pops in once (confirmation), then stays.
	 * Decorative: the surrounding text carries the meaning.
	 */
	type MarkState = 'idle' | 'waiting' | 'verified';
	let { state = 'idle', size = 'lg', class: className = '' }: { state?: MarkState; size?: 'sm' | 'md' | 'lg'; class?: string } =
		$props();

	const box = { sm: 'size-12', md: 'size-20', lg: 'size-28' };
	const mark = { sm: 'w-6', md: 'w-10', lg: 'w-14' };
</script>

<div class={cn('relative grid shrink-0 place-items-center', box[size], className)} aria-hidden="true">
	{#if state === 'waiting'}
		<span class="animate-ripple absolute inset-0 rounded-[26%] ring-2 ring-brand/60"></span>
	{/if}
	<div
		class={cn(
			'relative grid size-full place-items-center rounded-[26%] bg-brand text-brand-cream',
			'bg-[linear-gradient(160deg,rgb(255_255_255/0.16),transparent_55%)]',
			'shadow-[0_1px_1px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_118_111/0.45),inset_0_1px_0_rgb(255_255_255/0.28)]'
		)}
	>
		<RevibaseMark class={mark[size]} />
	</div>
	{#if state === 'verified'}
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
