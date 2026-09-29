<script lang="ts">
	import { cn } from '$lib/utils';

	/** The wallet's own icon when we have it, otherwise a stable two-tone mark derived from the address. */
	let { address, icon = null, size = 'md' }: { address: string; icon?: string | null; size?: 'sm' | 'md' } = $props();
	const hue = $derived([...address].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

{#if icon}
	<img src={icon} alt="" class={cn('rounded-[9px]', size === 'sm' ? 'size-7' : 'size-9')} />
{:else}
	<span
		aria-hidden="true"
		class={cn('block rounded-full', size === 'sm' ? 'size-7' : 'size-9')}
		style={`background: linear-gradient(135deg, oklch(0.78 0.1 ${hue}), oklch(0.55 0.11 ${(hue + 60) % 360}))`}
	></span>
{/if}
