<script lang="ts">
	import type { NftDisplayInfo } from 'phygital-nfts-client';
	import { getRarityTier, rarityAccentColor } from '$lib/card';
	import CardHero from './CardHero.svelte';
	import CardIdentity from './CardIdentity.svelte';
	import CardKeyStats from './CardKeyStats.svelte';
	import CardStats from './CardStats.svelte';
	import CardDescription from './CardDescription.svelte';
	import CardOwnership from './CardOwnership.svelte';
	import CardPricing from './CardPricing.svelte';
	import CardActions from './CardActions.svelte';

	let {
		nft,
		onClaim
	}: {
		nft: NftDisplayInfo;
		onClaim: () => void;
	} = $props();

	const rarityTier = $derived(getRarityTier(nft.attributes));
	const accentColor = $derived(rarityAccentColor(rarityTier));
</script>

<article class="card-detail" style={`--accent: ${accentColor}`}>
	<CardHero
		image={nft.image}
		name={nft.name}
		symbol={nft.symbol}
		{accentColor}
		{rarityTier}
	/>
	<CardIdentity
		collectionName={nft.collectionName}
		name={nft.name}
		symbol={nft.symbol}
		attributes={nft.attributes}
		expiry={nft.expiry}
	/>
	<CardKeyStats attributes={nft.attributes} />
	<CardStats attributes={nft.attributes} />
	<CardDescription description={nft.description} />
	<CardPricing {nft} />
	<CardActions {onClaim} />
	<CardOwnership mint={nft.mint} currentOwner={nft.currentOwner} />
</article>

<style>
	.card-detail {
		width: min(100%, 440px);
		padding: 0.25rem 0 1rem;
	}
</style>
