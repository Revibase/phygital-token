<script lang="ts">
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Copy from '@lucide/svelte/icons/copy';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { explorerUrl } from '#lib/shared/explorer.ts';
	import { copyText } from '#lib/client/clipboard.ts';
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import { shortAddress } from '#lib/shared/encoding.ts';

	let {
		address,
		label,
		context = null,
		cluster = null,
		nftOwnership = null,
		onforget,
		href,
		value
	}: {
		address: string;
		label: string;
		context?: string | null;
		cluster?: string | null;
		/** Clears the wallet name shown for this accessory. */
		onforget?: () => void;
		nftOwnership?: 'same' | 'different' | null;
		/** Opens this wallet's own page instead of the options menu. */
		href?: string;
		/** A trailing figure, such as the wallet's balance. */
		value?: string;
	} = $props();
	function copyAddress() {
		return copyText(address, 'Wallet address copied');
	}
</script>

{#snippet menu()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			aria-label="Owner options"
			class={buttonVariants({ variant: 'ghost', size: 'icon' })}
			><EllipsisVertical class="size-4" /></DropdownMenu.Trigger
		>
		<DropdownMenu.Content align="end" class="max-w-72">
			<DropdownMenu.Item onSelect={copyAddress}
				><Copy class="size-4 shrink-0" />Copy wallet address</DropdownMenu.Item
			>
			{#if cluster}
				<DropdownMenu.Item>
					{#snippet child({ props })}<a
							{...props}
							href={explorerUrl('address', address, cluster)}
							target="_blank"
							rel="noopener noreferrer"><ArrowUpRight class="size-4 shrink-0" />Open in explorer</a
						>{/snippet}
				</DropdownMenu.Item>
			{/if}
			{#if onforget}
				<DropdownMenu.Item onSelect={onforget}
					><RotateCcw class="size-4 shrink-0" />Forget wallet preference</DropdownMenu.Item
				>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<ListRow
	{label}
	detail={shortAddress(address)}
	subdetail={context ?? undefined}
	{href}
	{value}
	chevron={!!href}
	trailing={href ? undefined : menu}
>
	{#snippet labelBadge()}
		{#if nftOwnership}
			<span
				class="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium {nftOwnership ===
				'same'
					? 'bg-success/10 text-success'
					: 'bg-muted text-muted-foreground'}"
			>
				{#if nftOwnership === 'same'}<CircleCheck class="size-3 shrink-0" />Owns NFT{:else}NFT held
					elsewhere{/if}
			</span>
		{/if}
	{/snippet}
	{#snippet leading()}<WalletAvatar {address} />{/snippet}
</ListRow>
