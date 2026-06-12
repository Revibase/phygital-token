<script lang="ts">
	import type { CardAttribute } from 'phygital-nfts-client';
	import type { RarityTier } from '$lib/card';
	import { getKeyStats, getSetAttribute } from '$lib/card';
	import CardHero from './CardHero.svelte';

	let {
		image,
		name,
		symbol,
		accentColor,
		rarityTier,
		attributes,
		collectionName
	}: {
		image: string | null;
		name: string;
		symbol: string;
		accentColor: string;
		rarityTier: RarityTier;
		attributes: CardAttribute[];
		collectionName: string | null;
	} = $props();

	const keyStats = $derived(getKeyStats(attributes));
	const setAttribute = $derived(getSetAttribute(attributes));
	const setLabel = $derived(setAttribute?.value ?? collectionName ?? symbol);
</script>

<div class="showcase">
	<div class="playmat">
		{#if setLabel}
			<p class="set-badge">{setLabel}</p>
		{/if}
		<CardHero
			{image}
			{name}
			{symbol}
			{accentColor}
			{rarityTier}
			{keyStats}
		/>
	</div>
</div>

<style>
	.showcase {
		width: 100%;
	}

	.playmat {
		position: relative;
		padding: 1.25rem 1rem 1.5rem;
		border-radius: calc(var(--radius) + 8px);
		background:
			radial-gradient(circle at 50% 0%, color-mix(in oklch, var(--accent, var(--foreground)) 8%, transparent), transparent 55%),
			linear-gradient(180deg, color-mix(in oklch, var(--foreground) 4%, transparent), transparent 40%),
			var(--card);
		border: 1px solid var(--border);
		box-shadow: inset 0 1px 0 color-mix(in oklch, var(--foreground) 6%, transparent);
	}

	.set-badge {
		position: absolute;
		top: 0.85rem;
		right: 0.85rem;
		z-index: 2;
		margin: 0;
		max-width: 42%;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-foreground);
		background: color-mix(in oklch, var(--background) 70%, transparent);
		border: 1px solid var(--border);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
