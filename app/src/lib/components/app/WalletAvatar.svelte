<script lang="ts">
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import { cn } from '#lib/utils.ts';

	// Always the generic mark: wallets are shown by address, never by the app that connected them.
	let { size = 'md' }: { size?: 'sm' | 'md' } = $props();
</script>

<span
	aria-hidden="true"
	class={cn(
		'grid place-items-center rounded-[9px] bg-muted text-muted-foreground',
		size === 'sm' ? 'size-7' : 'size-9'
	)}><WalletIcon class={size === 'sm' ? 'size-3.5' : 'size-4'} /></span
>
