<script lang="ts">
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import ListRowSkeleton from './ListRowSkeleton.svelte';
	import Notice from './Notice.svelte';
	import Section from './Section.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import {
		isCollectible,
		transferRestriction,
		type WalletHoldings
	} from '$lib/shared/wallet-holdings';
	import {
		collectibleAssets,
		sendAssetRestriction,
		type SendAsset
	} from '$lib/shared/wallet-instructions';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';

	/** A wallet's SOL, tokens and collectibles. With `onselect`, tapping one starts sending it. */
	let {
		holdings,
		onselect,
		disabled = false
	}: {
		holdings: WalletHoldings | undefined;
		onselect?: (asset: SendAsset) => void;
		disabled?: boolean;
	} = $props();

	const interactive = $derived(!!onselect);
	const tokens = $derived(holdings?.tokens.filter((t) => !isCollectible(t)) ?? []);
	type Card = {
		asset: SendAsset;
		id: string;
		name: string;
		icon: string | null;
		restriction: string | null;
	};
	const collectibles = $derived(
		holdings
			? collectibleAssets(holdings).flatMap((asset): Card[] =>
					asset.kind === 'token'
						? [
								{
									asset,
									id: asset.token.tokenAccount,
									name: asset.token.name ?? shortAddress(asset.token.mint),
									icon: asset.token.icon,
									restriction: sendAssetRestriction(asset)
								}
							]
						: asset.kind === 'nft'
							? [
									{
										asset,
										id: asset.nft.id,
										name: asset.nft.name ?? shortAddress(asset.nft.id),
										icon: asset.nft.icon,
										restriction: sendAssetRestriction(asset)
									}
								]
							: []
				)
			: []
	);
</script>

{#if interactive && !disabled}<p class="px-1 text-[13px] text-muted-foreground">
		Tap an asset to send
	</p>{/if}
<List label="Tokens">
	{#if !holdings}
		{#each [0, 1] as i (i)}<ListRowSkeleton />{/each}
	{:else}
		<ListRow
			label="Solana"
			detail="SOL"
			value={formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)}
			onclick={onselect ? () => onselect({ kind: 'sol' }) : undefined}
			disabled={interactive && disabled}
			chevron={interactive}
		>
			{#snippet leading()}<TokenIcon src={SOL_INFO.icon} label="SOL" />{/snippet}
		</ListRow>
		{#if !tokens.length}<li class="px-4 py-5 text-[14px] text-muted-foreground">
				{interactive ? 'Tokens you receive will appear here.' : 'No tokens.'}
			</li>{/if}
		{#each tokens as t (t.tokenAccount)}
			<ListRow
				label={t.name ?? t.symbol ?? shortAddress(t.mint)}
				detail={interactive && transferRestriction(t)
					? 'Can’t be sent'
					: (t.symbol ?? shortAddress(t.mint))}
				value={formatCompactTokenAmount(t.amount, t.decimals)}
				onclick={onselect ? () => onselect({ kind: 'token', token: t }) : undefined}
				disabled={interactive && disabled}
				chevron={interactive}
			>
				{#snippet leading()}<TokenIcon src={t.icon} label={t.symbol ?? t.mint} />{/snippet}
			</ListRow>
		{/each}
	{/if}
</List>

{#if holdings?.nftStatus === 'unavailable' || holdings?.nftStatus === 'partial'}<Notice
		tone="info"
		title="Some collectibles may be missing"
		body="We couldn’t load all your collectibles. Refresh before sending all."
	/>{/if}
{#if collectibles.length}
	<Section label="Collectibles">
		<div class="grid grid-cols-2 gap-3">
			{#each collectibles as nft (nft.id)}
				{#snippet card()}
					{#if nft.icon}<img
							src={nft.icon}
							alt=""
							class="aspect-square w-full object-cover"
							loading="lazy"
						/>{:else}<div
							class="grid aspect-square place-items-center bg-muted text-4xl text-muted-foreground"
						>
							◇
						</div>{/if}
					<div class="space-y-1 p-3">
						<p class="truncate text-[14px] font-medium">{nft.name}</p>
						{#if nft.restriction && interactive}<p class="text-[12px] text-muted-foreground">
								Can’t be sent yet
							</p>{/if}
					</div>
				{/snippet}
				{#if onselect}
					<button
						type="button"
						{disabled}
						onclick={() => onselect(nft.asset)}
						class="overflow-hidden rounded-2xl border bg-card text-left outline-none transition-colors enabled:hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={`Send ${nft.name}`}>{@render card()}</button
					>
				{:else}
					<div class="overflow-hidden rounded-2xl border bg-card">{@render card()}</div>
				{/if}
			{/each}
		</div>
	</Section>
{/if}
