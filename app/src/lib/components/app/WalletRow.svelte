<script lang="ts">
	import { buttonVariants } from '#lib/components/ui/button/index.ts';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Copy from '@lucide/svelte/icons/copy';
	import { copyText } from '#lib/client/clipboard.ts';
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import { shortAddress } from '#lib/shared/encoding.ts';

	let {
		address,
		label,
		context = null,
		nftOwnership = null,
		href,
		value
	}: {
		address: string;
		/** Without one, the address is the label. */
		label?: string;
		context?: string | null;
		nftOwnership?: 'same' | 'different' | null;
		/** Opens this wallet's own page instead of offering to copy its address. */
		href?: string;
		/** A trailing figure, such as the wallet's balance. */
		value?: string;
	} = $props();
</script>

{#snippet copy()}
	<button
		type="button"
		aria-label="Copy wallet address"
		class={buttonVariants({ variant: 'ghost', size: 'icon' })}
		onclick={() => copyText(address, 'Wallet address copied')}><Copy class="size-4" /></button
	>
{/snippet}

<ListRow
	label={label ?? shortAddress(address)}
	detail={label ? shortAddress(address) : undefined}
	subdetail={context ?? undefined}
	{href}
	{value}
	chevron={!!href}
	trailing={href ? undefined : copy}
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
	{#snippet leading()}<WalletAvatar />{/snippet}
</ListRow>
