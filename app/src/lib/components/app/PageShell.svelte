<script lang="ts">
	import type { Snippet } from 'svelte';
	import { networkLabel } from '#lib/shared/explorer.ts';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import WalletButton from './WalletButton.svelte';
	import type { Cluster } from '#lib/client/wallet/wallet.svelte.ts';

	let {
		children,
		footer,
		size = 'narrow',
		back = false,
		connect = true
	}: {
		children: Snippet;
		footer?: Snippet;
		size?: 'narrow' | 'medium' | 'wide';
		/** A secondary place: reached from another screen, it offers Back instead of the home link. */
		back?: boolean;
		/** False when the page shows its own Connect wallet button: the header then shows only a connected wallet. */
		connect?: boolean;
	} = $props();

	// The installed app (display: standalone) has no browser back button.
	let arrivedInApp = $state(false);
	afterNavigate(({ from }) => {
		arrivedInApp =
			!!from && from.url.origin === page.url.origin && from.url.pathname !== page.url.pathname;
	});
	const showBack = $derived(back && arrivedInApp);

	// Wallet users check the network before they sign; only a non-mainnet one needs saying.
	const cluster = $derived((page.data as { cluster?: Cluster }).cluster);
	const network = $derived(networkLabel(cluster));

	const max = { narrow: 'lg:max-w-[440px]', medium: 'lg:max-w-[560px]', wide: 'lg:max-w-[920px]' };
</script>

<div class="flex min-h-dvh w-full flex-col">
	<header
		class="pt-[max(0.75rem,env(safe-area-inset-top))] lg:border-b lg:border-border/70 lg:pt-0"
	>
		<div
			class="mx-auto flex h-12 w-full max-w-[440px] items-center justify-between px-5 lg:h-14 lg:max-w-none lg:px-8"
		>
			{#if showBack}
				<button
					type="button"
					onclick={() => history.back()}
					class="-mx-2 inline-flex h-11 items-center gap-1 rounded-lg px-2 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
				>
					<ChevronLeft class="-ml-1 size-5" />Back
				</button>
			{/if}
			<div class="ml-auto flex items-center gap-2">
				{#if network}
					<span
						class="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
						title="Solana network">{network}</span
					>
				{/if}
				{#if cluster && page.url.pathname !== '/wallet'}<WalletButton {cluster} {connect} />{/if}
			</div>
		</div>
	</header>
	<div class="flex flex-1 flex-col lg:justify-center">
		<div
			class="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:flex-none lg:px-8 lg:py-12 {max[
				size
			]}"
		>
			<main class="flex flex-1 flex-col">
				{@render children()}
			</main>
			{#if footer}<footer class="pt-6">{@render footer()}</footer>{/if}
		</div>
	</div>
</div>
