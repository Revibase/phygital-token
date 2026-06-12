<script lang="ts">
	import { onMount } from 'svelte';
	import type { NftDisplayInfo } from 'phygital-nfts-client';
	import { fetchMarketplaceQuote, type MarketplaceQuote } from '$lib/marketplace';

	let { nft }: { nft: NftDisplayInfo } = $props();

	let marketQuote = $state<MarketplaceQuote | null>(null);

	onMount(async () => {
		marketQuote = await fetchMarketplaceQuote(nft.mint);
	});
</script>

<section class="pricing">
	<div class="market">
		<div class="market-header">
			<h2>Market</h2>
			<span class="badge">Coming soon</span>
		</div>
		<div class="row muted">
			<span class="label">Floor price</span>
			<span class="value">—</span>
		</div>
		<div class="row muted">
			<span class="label">Listings</span>
			<span class="value">{marketQuote?.listingCount ?? '—'}</span>
		</div>
		<div class="row muted">
			<span class="label">Last sale</span>
			<span class="value">—</span>
		</div>
	</div>
</section>

<style>
	.pricing {
		margin-top: 1.5rem;
		margin-left: 1rem;
		margin-right: 1rem;
		padding: 1rem;
		border-radius: calc(var(--radius) + 4px);
		background: var(--card);
		border: 1px solid var(--border);
		box-shadow: 0 1px 2px var(--shadow-color);
	}

	h2 {
		margin: 0 0 0.65rem;
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted-foreground);
	}

	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.35rem 0;
	}

	.label {
		font-size: 0.9rem;
		color: var(--muted-foreground);
	}

	.value {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--foreground);
		text-align: right;
	}

	.market-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.35rem;
	}

	.market-header h2 {
		margin: 0;
	}

	.badge {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		background: var(--muted);
	}

	.muted .value {
		font-weight: 500;
		color: var(--muted-foreground);
	}
</style>
