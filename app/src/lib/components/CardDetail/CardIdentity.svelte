<script lang="ts">
	import {
		formatCardNumber,
		getCardNumberAttribute,
		getRarityAttribute,
		getSetAttribute,
		rarityAccentColor,
		getRarityTier
	} from '$lib/card';
	import { formatCardExpiry } from '$lib/format';
	import type { CardAttribute } from 'phygital-nfts-client';

	let {
		collectionName,
		name,
		symbol,
		attributes,
		expiry
	}: {
		collectionName: string | null;
		name: string;
		symbol: string;
		attributes: CardAttribute[];
		expiry: number | null;
	} = $props();

	const rarity = $derived(getRarityAttribute(attributes));
	const rarityTier = $derived(getRarityTier(attributes));
	const rarityColor = $derived(rarityAccentColor(rarityTier));
	const setAttribute = $derived(getSetAttribute(attributes));
	const cardNumber = $derived(getCardNumberAttribute(attributes));

	const setEyebrow = $derived(setAttribute?.value ?? collectionName ?? 'Phygital Collection');

	const numberLine = $derived.by(() => {
		const parts: string[] = [];
		if (cardNumber) {
			parts.push(formatCardNumber(cardNumber.value));
		}
		if (symbol) {
			parts.push(symbol);
		}
		return parts.length > 0 ? parts.join(' · ') : null;
	});

	const expiryLabel = $derived(
		expiry !== null ? formatCardExpiry(expiry) : null
	);
</script>

<header class="identity">
	<p class="eyebrow">{setEyebrow}</p>
	<div class="title-row">
		<h1>{name}</h1>
		{#if rarity}
			<span class="rarity" style={`--rarity-color: ${rarityColor}`}>{rarity.value}</span>
		{/if}
	</div>
	{#if numberLine}
		<p class="number-line">{numberLine}</p>
	{/if}
	{#if expiryLabel}
		<p class="expiry">Valid until {expiryLabel}</p>
	{/if}
</header>

<style>
	.identity {
		margin-top: 1.25rem;
		padding: 0 1rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--muted-foreground);
	}

	.title-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.35rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(1.5rem, 4vw, 1.85rem);
		line-height: 1.15;
		color: var(--foreground);
	}

	.rarity {
		flex-shrink: 0;
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--rarity-color);
		background: color-mix(in srgb, var(--rarity-color) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--rarity-color) 35%, transparent);
	}

	.number-line {
		margin: 0.35rem 0 0;
		color: var(--muted-foreground);
		font-weight: 600;
		font-size: 0.9rem;
		letter-spacing: 0.04em;
	}

	.expiry {
		margin: 0.5rem 0 0;
		color: var(--muted-foreground);
		font-size: 0.85rem;
	}
</style>
