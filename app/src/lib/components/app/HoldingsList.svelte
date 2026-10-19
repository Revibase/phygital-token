<script lang="ts">
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import ListRowSkeleton from './ListRowSkeleton.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { formatUsd, tokenLabel, type WalletHoldings } from '#lib/shared/wallet-holdings.ts';
	import type { SendAsset } from '#lib/shared/wallet-transfer.ts';

	/** The wallet's SOL and tokens. With `onselect`, tapping one starts sending it. */
	let {
		holdings,
		label = 'Assets',
		onselect
	}: {
		holdings: WalletHoldings | undefined;
		label?: string | null;
		onselect?: (asset: SendAsset) => void;
	} = $props();

	const usd = (amount: bigint, decimals: number, price: number | null) =>
		price === null ? undefined : formatUsd((Number(amount) / 10 ** decimals) * price);
</script>

<List label={label ?? undefined}>
	{#if !holdings}
		{#each [0, 1] as i (i)}<ListRowSkeleton />{/each}
	{:else}
		<ListRow
			label="Solana"
			detail={usd(holdings.lamports, SOL_DECIMALS, holdings.solPriceUsd) ?? 'SOL'}
			value={`${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`}
			onclick={onselect ? () => onselect({ kind: 'sol' }) : undefined}
			chevron={!!onselect}
		>
			{#snippet leading()}<TokenIcon src="/solana.svg" label="SOL" />{/snippet}
		</ListRow>
		{#each holdings.tokens as token (token.tokenAccount)}
			<ListRow
				label={token.name ?? tokenLabel(token)}
				detail={token.frozen
					? 'Frozen · can’t be sent'
					: (usd(token.amount, token.decimals, token.priceUsd) ??
						(token.name && token.symbol ? token.symbol : 'Token'))}
				value={`${formatCompactTokenAmount(token.amount, token.decimals)}${token.symbol ? ` ${token.symbol}` : ''}`}
				onclick={onselect && !token.frozen ? () => onselect({ kind: 'token', token }) : undefined}
				chevron={!!onselect && !token.frozen}
			>
				{#snippet leading()}<TokenIcon src={token.icon} label={tokenLabel(token)} />{/snippet}
			</ListRow>
		{/each}
		{#if !holdings.tokens.length}<li class="px-4 py-5 text-[14px] text-muted-foreground">
				Tokens you receive will appear here.
			</li>{/if}
	{/if}
</List>
