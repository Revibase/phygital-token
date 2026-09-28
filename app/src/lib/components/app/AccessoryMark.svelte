<script lang="ts">
	import { cn } from '$lib/utils';
	import RevibaseMark from '$lib/brand/RevibaseMark.svelte';

	type MarkState = 'idle' | 'waiting' | 'verified' | 'linked';
	let { tag = '', state = 'idle', size = 'lg', class: className = '' }: { tag?: string; state?: MarkState; size?: 'sm' | 'lg'; class?: string } =
		$props();
</script>

<!-- The physical accessory: a Revibase tile. Decorative — meaning is conveyed in text nearby. -->
<div class={cn('relative grid place-items-center', size === 'lg' ? 'size-40' : 'size-16', className)} aria-hidden="true">
	{#if state === 'waiting'}
		<span class="animate-ripple absolute inset-0 rounded-[28%] border border-brand/70"></span>
		<span class="animate-ripple absolute inset-0 rounded-[28%] border border-brand/40 [animation-delay:600ms]"></span>
	{/if}
	{#if state === 'verified' || state === 'linked'}
		<span class="absolute inset-[-12%] rounded-full bg-glow blur-2xl"></span>
	{/if}
	<div
		class={cn(
			'relative grid size-full place-items-center overflow-hidden rounded-[28%] border border-white/20',
			'bg-[radial-gradient(120%_120%_at_20%_10%,#3fe0d6,var(--brand)_45%,#008f87)]',
			'shadow-[0_20px_50px_-20px_rgb(0_194_184/0.65),inset_0_1px_0_rgb(255_255_255/0.45)]'
		)}
	>
		<span class="animate-sheen absolute inset-y-[-40%] left-0 w-1/4 bg-white/20 blur-md"></span>
		<div class="relative flex flex-col items-center gap-2 text-brand-cream">
			<RevibaseMark class={size === 'lg' ? 'w-16' : 'w-8'} />
			{#if size === 'lg' && tag}
				<span class="font-mono text-[11px] tracking-[0.35em] text-brand-cream/80">{tag}</span>
			{/if}
		</div>
	</div>
	{#if state === 'verified' || state === 'linked'}
		<span
			class={cn(
				'absolute -right-1 -bottom-1 grid place-items-center rounded-full border-4 border-background bg-success text-background shadow-lg',
				size === 'lg' ? 'size-10' : 'size-7 border-[3px]'
			)}
		>
			<svg viewBox="0 0 24 24" class={size === 'lg' ? 'size-5' : 'size-3.5'} fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
				<path class="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
			</svg>
		</span>
	{/if}
</div>
