<script lang="ts">
	import { onMount } from 'svelte';
	import { computeTransferBreakdown, type NftDisplayInfo } from 'phygital-nfts-client';
	import { fetchMarketplaceQuote, type MarketplaceQuote } from '$lib/marketplace';
	import { formatLamports, formatTokenAmount } from '$lib/format';

	let { nft }: { nft: NftDisplayInfo } = $props();

	let marketQuote = $state<MarketplaceQuote | null>(null);
	let breakdownOpen = $state(false);

	const hasPrice = $derived(nft.transferPrice > 0n);
	const breakdown = $derived(
		computeTransferBreakdown(nft.transferPrice, nft.groupRoyaltyBps, nft.domainRoyaltyBps)
	);

	const claimPriceLabel = $derived(
		hasPrice
			? nft.paymentTokenMint
				? formatTokenAmount(nft.transferPrice, nft.paymentTokenSymbol)
				: formatLamports(nft.transferPrice)
			: 'Free'
	);

	onMount(async () => {
		marketQuote = await fetchMarketplaceQuote(nft.mint);
	});
</script>

<section class="pricing">
	<div class="claim-block">
		<h2>Claim</h2>
		<div class="row">
			<span class="label">Price to claim</span>
			<span class="value">{claimPriceLabel}</span>
		</div>

		{#if hasPrice && (breakdown.groupRoyaltyAmount > 0n || breakdown.sellerAmount > 0n)}
			<button type="button" class="breakdown-toggle" onclick={() => (breakdownOpen = !breakdownOpen)}>
				{breakdownOpen ? 'Hide breakdown' : 'Show breakdown'}
			</button>
			{#if breakdownOpen}
				<dl class="breakdown">
					{#if breakdown.sellerAmount > 0n}
						<div>
							<dt>To current owner</dt>
							<dd>
								{nft.paymentTokenMint
									? formatTokenAmount(breakdown.sellerAmount, nft.paymentTokenSymbol)
									: formatLamports(breakdown.sellerAmount)}
							</dd>
						</div>
					{/if}
					{#if breakdown.groupOwnerAmount > 0n}
						<div>
							<dt>Collection royalty</dt>
							<dd>
								{nft.paymentTokenMint
									? formatTokenAmount(breakdown.groupOwnerAmount, nft.paymentTokenSymbol)
									: formatLamports(breakdown.groupOwnerAmount)}
							</dd>
						</div>
					{/if}
					{#if breakdown.domainFee > 0n}
						<div>
							<dt>Platform fee</dt>
							<dd>
								{nft.paymentTokenMint
									? formatTokenAmount(breakdown.domainFee, nft.paymentTokenSymbol)
									: formatLamports(breakdown.domainFee)}
							</dd>
						</div>
					{/if}
				</dl>
			{/if}
		{/if}
	</div>

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

	.claim-block h2 {
		margin-bottom: 0.5rem;
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
		font-size: 1rem;
		font-weight: 700;
		color: var(--foreground);
	}

	.breakdown-toggle {
		margin-top: 0.35rem;
		border: 0;
		background: transparent;
		color: var(--foreground);
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0;
	}

	.breakdown {
		margin: 0.5rem 0 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}

	.breakdown div {
		display: flex;
		justify-content: space-between;
		padding: 0.25rem 0;
	}

	.breakdown dt {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted-foreground);
	}

	.breakdown dd {
		margin: 0;
		font-size: 0.85rem;
		color: var(--foreground);
	}

	.market {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
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
