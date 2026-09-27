<script lang="ts">
	import { cn } from '$lib/utils';
	import NfcIcon from '@lucide/svelte/icons/nfc';

	type MarkState = 'idle' | 'waiting' | 'verified' | 'linked';
	let { tag = '', state = 'idle', size = 'lg', class: className = '' }: { tag?: string; state?: MarkState; size?: 'sm' | 'lg'; class?: string } =
		$props();
</script>

<!-- The physical object, rendered as a brushed-metal token. Decorative: meaning is conveyed in text nearby. -->
<div class={cn('relative grid place-items-center', size === 'lg' ? 'size-40' : 'size-16', className)} aria-hidden="true">
	{#if state === 'waiting'}
		<span class="animate-ripple absolute inset-0 rounded-[32%] border border-primary/60"></span>
		<span class="animate-ripple absolute inset-0 rounded-[32%] border border-primary/40 [animation-delay:600ms]"></span>
	{/if}
	{#if state === 'verified' || state === 'linked'}
		<span class="absolute inset-[-12%] rounded-full bg-glow blur-2xl"></span>
	{/if}
	<div
		class={cn(
			'relative grid size-full place-items-center overflow-hidden rounded-[32%] border shadow-xl',
			'border-white/15 bg-[radial-gradient(120%_120%_at_20%_10%,oklch(0.93_0.06_85),oklch(0.72_0.11_72)_45%,oklch(0.42_0.07_60))]',
			'shadow-[0_20px_50px_-20px_oklch(0.6_0.12_70/0.7),inset_0_1px_0_oklch(1_0_0/0.5)]'
		)}
	>
		<span class="animate-sheen absolute inset-y-[-40%] left-0 w-1/4 bg-white/25 blur-md"></span>
		<div class="relative flex flex-col items-center gap-1 text-[oklch(0.25_0.04_60)]">
			<NfcIcon class={size === 'lg' ? 'size-9' : 'size-5'} strokeWidth={1.5} />
			{#if size === 'lg' && tag}
				<span class="font-mono text-xs tracking-[0.35em] opacity-70">{tag}</span>
			{/if}
		</div>
	</div>
	{#if state === 'verified' || state === 'linked'}
		<span class="absolute -right-1 -bottom-1 grid size-10 place-items-center rounded-full border-4 border-background bg-success text-background shadow-lg">
			<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
				<path class="animate-draw" d="M5 12.5l4.5 4.5L19 7.5" />
			</svg>
		</span>
	{/if}
</div>
