<script lang="ts">
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import { cn } from '#lib/utils.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';

	let { address, size = 'md' }: { address: string; size?: 'sm' | 'md' } = $props();

	// Only the connected wallet has a known app; any other address gets the generic mark.
	const icon = $derived(walletStore.address === address ? walletStore.walletIcon : null);
</script>

{#if icon}
	<img src={icon} alt="" class={cn('rounded-[9px]', size === 'sm' ? 'size-7' : 'size-9')} />
{:else}
	<span
		aria-hidden="true"
		class={cn(
			'grid place-items-center rounded-[9px] bg-muted text-muted-foreground',
			size === 'sm' ? 'size-7' : 'size-9'
		)}><WalletIcon class={size === 'sm' ? 'size-3.5' : 'size-4'} /></span
	>
{/if}
