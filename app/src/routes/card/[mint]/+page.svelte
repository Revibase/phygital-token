<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { fetchNftDisplayInfo, type NftDisplayInfo } from 'phygital-nfts-client';
	import CardDetail from '$lib/components/CardDetail/CardDetail.svelte';
	import InAppBrowserBanner from '$lib/components/InAppBrowserBanner.svelte';
	import TransferSheet from '$lib/components/TransferSheet.svelte';
	import { canClaimInThisBrowser } from '$lib/browser-capability';
	import { pageTitle } from '$lib/page-context';
	import { getRpc } from '$lib/rpc';
	import { parseMintParam } from '$lib/transfer';

	let nft = $state<NftDisplayInfo | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let sheetOpen = $state(false);
	let sheetError = $state<string | null>(null);
	let claimDeepLinkHandled = $state(false);

	const canClaim = $derived(canClaimInThisBrowser());

	async function loadNft(mintParam: string) {
		loading = true;
		error = null;
		sheetError = null;
		nft = null;

		try {
			const mint = parseMintParam(mintParam);
			nft = await fetchNftDisplayInfo(getRpc(), mint);
			pageTitle.set(nft.collectionName ?? nft.name);
		} catch (loadError) {
			pageTitle.set(null);
			error = loadError instanceof Error ? loadError.message : 'Failed to load card';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser) {
			return;
		}
		const mint = $page.params.mint;
		if (mint) {
			void loadNft(mint);
		}
	});

	$effect(() => {
		return () => {
			pageTitle.set(null);
		};
	});

	$effect(() => {
		if (!browser || !nft || claimDeepLinkHandled || !canClaim) {
			return;
		}
		if ($page.url.searchParams.get('claim') === '1') {
			claimDeepLinkHandled = true;
			sheetOpen = true;
		}
	});

	function handleClaim() {
		if (!canClaim) {
			return;
		}
		sheetError = null;
		sheetOpen = true;
	}

	async function handleTransferComplete() {
		if (!nft) {
			return;
		}
		nft = await fetchNftDisplayInfo(getRpc(), nft.cardInstance);
	}
</script>

<section class="panel">
	{#if loading}
		<div class="loading">
			<div class="skeleton-card" aria-hidden="true"></div>
			<p>Loading card…</p>
		</div>
	{:else if error && !nft}
		<div class="message error-box">
			<h1>Card not found</h1>
			<p>{error}</p>
			<p class="hint">Try a URL like <code>/card/&lt;instance-address&gt;</code></p>
		</div>
	{:else if nft}
		{#if !canClaim}
			<InAppBrowserBanner />
		{/if}
		<CardDetail {nft} {canClaim} onClaim={handleClaim} />
		<TransferSheet bind:open={sheetOpen} {nft} onComplete={handleTransferComplete} />
		{#if sheetError}
			<p class="status error">{sheetError}</p>
		{/if}
	{/if}
</section>

<style>
	.panel {
		width: min(100%, 480px);
		display: grid;
		gap: 1rem;
		justify-items: center;
		padding-bottom: 5.5rem;
	}

	.loading {
		width: min(100%, 440px);
		display: grid;
		gap: 1rem;
		justify-items: center;
		color: var(--muted-foreground);
	}

	.skeleton-card {
		width: 100%;
		aspect-ratio: 2 / 3;
		border-radius: calc(var(--radius) + 4px);
		background: linear-gradient(
			110deg,
			var(--muted) 8%,
			var(--secondary) 18%,
			var(--muted) 33%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s linear infinite;
	}

	.error-box {
		padding: 1.5rem;
		border-radius: calc(var(--radius) + 4px);
		background: var(--card);
		border: 1px solid color-mix(in oklch, var(--destructive) 35%, transparent);
		text-align: center;
		box-shadow: 0 1px 2px var(--shadow-color);
	}

	.error-box h1 {
		margin: 0 0 0.5rem;
		font-size: 1.25rem;
		color: var(--destructive);
	}

	.hint {
		margin-top: 1rem;
		font-size: 0.9rem;
		color: var(--muted-foreground);
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.status {
		margin: 0;
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: var(--card);
		border: 1px solid var(--border);
		font-size: 0.85rem;
		color: var(--foreground);
		word-break: break-all;
	}

	.status.error {
		border-color: color-mix(in oklch, var(--destructive) 35%, transparent);
		color: var(--destructive);
	}

	@keyframes shimmer {
		to {
			background-position-x: -200%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-card {
			animation: none;
		}
	}
</style>
