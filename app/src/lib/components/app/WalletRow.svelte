<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Copy from '@lucide/svelte/icons/copy';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { explorerUrl } from '$lib/shared/explorer';
	import { toast } from 'svelte-sonner';
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import { shortAddress } from '$lib/shared/encoding';

	let { address, label, icon = null, context = null, cluster = null, onforget = undefined, nftOwnership = null }: { address: string; label: string; icon?: string | null; context?: string | null; cluster?: string | null; onforget?: () => void; nftOwnership?: 'same' | 'different' | null } = $props();
	async function copyAddress() {
		try { await navigator.clipboard.writeText(address); toast.success('Wallet address copied'); }
		catch { toast.error('Couldn’t copy. Select the text instead.'); }
	}
	const menuItem = 'flex cursor-pointer items-center min-h-11 gap-3 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-muted';
</script>

<ListRow {label} detail={shortAddress(address)} subdetail={context ?? undefined}>
	{#snippet labelBadge()}
		{#if nftOwnership}
			<span class="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium {nftOwnership === 'same' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}">
				{#if nftOwnership === 'same'}<CircleCheck class="size-3 shrink-0" />Owns NFT{:else}NFT held elsewhere{/if}
			</span>
		{/if}
	{/snippet}
	{#snippet leading()}<WalletAvatar {address} {icon} />{/snippet}
	{#snippet trailing()}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger aria-label="Owner options" class="grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><EllipsisVertical class="size-4" /></DropdownMenu.Trigger>
			<DropdownMenu.Portal><DropdownMenu.Content sideOffset={4} align="end" class="z-50 max-w-72 rounded-xl border bg-popover p-1 shadow-md">
				<DropdownMenu.Item onSelect={copyAddress} class={menuItem}><Copy class="size-4 shrink-0" />Copy wallet address</DropdownMenu.Item>
				{#if cluster}
					<DropdownMenu.Item>
						{#snippet child({ props })}<a {...props} href={explorerUrl('address', address, cluster)} target="_blank" rel="noopener noreferrer" class={menuItem}><ArrowUpRight class="size-4 shrink-0" />Open in explorer</a>{/snippet}
					</DropdownMenu.Item>
				{/if}
				{#if onforget}
					<DropdownMenu.Item onSelect={onforget} class={menuItem}><RotateCcw class="size-4 shrink-0" />Forget wallet preference</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content></DropdownMenu.Portal>
		</DropdownMenu.Root>
	{/snippet}
</ListRow>
