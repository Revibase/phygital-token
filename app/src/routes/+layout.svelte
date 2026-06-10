<script lang="ts">
	import '../app.css';
	import WalletButton from '$lib/components/WalletButton.svelte';
	import { BRAND_COLORS } from '$lib/themes';
	import { buildThemeBootstrapScript } from '$lib/theme-bootstrap';

	let { children } = $props();

	const themeBootstrapScript = buildThemeBootstrapScript();
</script>

<svelte:head>
	<meta name="theme-color" content={BRAND_COLORS.surface} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html '<scr' + 'ipt>' + themeBootstrapScript + '</scr' + 'ipt>'}
</svelte:head>

<div class="app">
	<header>
		<div>
			<p class="brand-kicker">Phygital NFTs</p>
			<h2 class="brand-title">Phygital Cards</h2>
		</div>
		<WalletButton />
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.app {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--background);
		color: var(--foreground);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.brand-kicker {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--muted-foreground);
	}

	.brand-title {
		margin: 0.15rem 0 0;
		font-size: 1.1rem;
		font-weight: 700;
	}

	main {
		display: grid;
		place-items: center;
		padding: 2rem 1rem 3rem;
	}
</style>
