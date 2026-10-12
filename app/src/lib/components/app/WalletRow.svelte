<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { buttonVariants } from '$lib/components/ui/button';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { explorerUrl } from '$lib/shared/explorer';
	import { copyText } from '$lib/client/clipboard';
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import { shortAddress } from '$lib/shared/encoding';

	let { address, label, icon = null, context = null, cluster = null, nftOwnership = null, onexport }: { address: string; label: string; icon?: string | null; context?: string | null; cluster?: string | null; onexport?: () => void; nftOwnership?: 'same' | 'different' | null } = $props();
	function copyAddress() { return copyText(address, 'Wallet address copied'); }

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
			<DropdownMenu.Trigger aria-label="Owner options" class={buttonVariants({ variant: 'ghost', size: 'icon' })}><EllipsisVertical class="size-4" /></DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="max-w-72">
				<DropdownMenu.Item onSelect={copyAddress}><Copy class="size-4 shrink-0" />Copy wallet address</DropdownMenu.Item>
				{#if cluster}
					<DropdownMenu.Item>
						{#snippet child({ props })}<a {...props} href={explorerUrl('address', address, cluster)} target="_blank" rel="noopener noreferrer"><ArrowUpRight class="size-4 shrink-0" />Open in explorer</a>{/snippet}
					</DropdownMenu.Item>
				{/if}
				{#if onexport}
					<DropdownMenu.Item onSelect={onexport}><KeyRound class="size-4 shrink-0" />Export key</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/snippet}
</ListRow>
