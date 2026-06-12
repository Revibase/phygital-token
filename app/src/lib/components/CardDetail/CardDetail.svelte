<script lang="ts">
	import type { NftDisplayInfo } from 'phygital-nfts-client';
	import { getRarityTier, rarityAccentColor } from '$lib/card';
	import CardShowcase from './CardShowcase.svelte';
	import CardIdentity from './CardIdentity.svelte';
	import CardStats from './CardStats.svelte';
	import CardDescription from './CardDescription.svelte';
	import CardOwnership from './CardOwnership.svelte';
	import CardPricing from './CardPricing.svelte';
	import CardActions from './CardActions.svelte';

	let {
		nft,
		canClaim,
		onClaim
	}: {
		nft: NftDisplayInfo;
		canClaim: boolean;
		onClaim: () => void;
	} = $props();

	const rarityTier = $derived(getRarityTier(nft.attributes));
	const accentColor = $derived(rarityAccentColor(rarityTier));
</script>

<article class="card-detail" style={`--accent: ${accentColor}`}>
	<CardShowcase
		image={nft.image}
		name={nft.name}
		symbol={nft.symbol}
		{accentColor}
		{rarityTier}
		attributes={nft.attributes}
		collectionName={nft.collectionName}
	/>
	<CardIdentity
		collectionName={nft.collectionName}
		name={nft.name}
		symbol={nft.symbol}
		attributes={nft.attributes}
		expiry={nft.expiry}
	/>
	<CardStats attributes={nft.attributes} />
	<CardDescription description={nft.description} />
	<CardPricing {nft} />
	<CardOwnership
		cardInstance={nft.cardInstance}
		designMint={nft.designMint}
		currentOwner={nft.currentOwner}
	/>
	<CardActions {canClaim} {onClaim} />
</article>

<style>
	.card-detail {
		width: min(100%, 440px);
		padding: 0.25rem 0 0;
	}
</style>
