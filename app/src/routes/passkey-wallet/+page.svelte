<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { canSpendLamports, topUpNeeded } from 'phygital-token-sdk';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import ResponsiveSheet from '$lib/components/app/ResponsiveSheet.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import WalletConnect from '$lib/components/app/WalletConnect.svelte';
	import HoldingsList from '$lib/components/app/HoldingsList.svelte';
	import ReceiveSheet from '$lib/components/app/ReceiveSheet.svelte';
	import PasskeySendSheet from '$lib/components/app/PasskeySendSheet.svelte';
	import PasskeySendAllSheet from '$lib/components/app/PasskeySendAllSheet.svelte';
	import PasskeyWalletExplainer from '$lib/components/app/PasskeyWalletExplainer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { passkeyWalletQuery } from '$lib/client/queries';
	import { MAX_NETWORK_FEE } from '$lib/client/passkey-wallet/send';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import {
		passkeyWallet,
		PASSKEY_WALLET_ICON,
		PASSKEY_WALLET_NAME
	} from '$lib/client/wallet/secure-signer';
	import { formatTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { formatUsd, portfolioValue, transferRestriction } from '$lib/shared/wallet-holdings';
	import type { SendAsset } from '$lib/shared/wallet-instructions';

	let { data } = $props();

	onMount(() => walletStore.init(data.cluster));

	// Only the passkey wallet lives here: any other wallet has its own app for balances and sends.
	const isPasskey = $derived(walletStore.walletName === PASSKEY_WALLET_NAME);
	const address = $derived(isPasskey ? walletStore.address : null);
	const holdingsQuery = createQuery(() => ({
		...passkeyWalletQuery(address ?? ''),
		enabled: !!address
	}));
	const holdings = $derived(address ? holdingsQuery.data : undefined);
	const valuation = $derived(holdings ? portfolioValue(holdings) : null);
	const empty = $derived(
		!!holdings && !holdings.lamports && !holdings.tokens.length && !holdings.nfts?.length
	);
	const sendable = $derived(
		!!holdings &&
			(!!holdings.lamports ||
				holdings.tokens.some((t) => !transferRestriction(t)) ||
				(holdings.nfts ?? []).some((n) => !n.frozen))
	);
	// Tokens and NFTs can't move without SOL for the fee: say so before anyone tries.
	const feeShortfall = $derived(
		holdings &&
			!empty &&
			(holdings.tokens.length > 0 || !!holdings.nfts?.length) &&
			!canSpendLamports(holdings.lamports, MAX_NETWORK_FEE)
			? topUpNeeded(holdings.lamports, MAX_NETWORK_FEE)
			: null
	);

	let receiveOpen = $state(false);
	let sendOpen = $state(false);
	let sendAllOpen = $state(false);
	let aboutOpen = $state(false);
	let selectedAsset = $state<SendAsset>({ kind: 'sol' });
	function selectAsset(asset: SendAsset) {
		selectedAsset = asset;
		sendOpen = true;
	}
	$effect(() => {
		if (!address) {
			sendOpen = false;
			sendAllOpen = false;
			receiveOpen = false;
		}
	});
</script>

<svelte:head><title>Passkey wallet · Revibase</title></svelte:head>

<PageShell size="medium">
	<section class="flex flex-1 flex-col gap-6 pt-4 pb-10">
		<nav class="flex items-center justify-between" aria-label="Wallet navigation">
			<Button href="/" variant="quiet" class="-ml-3 gap-1"
				><ArrowLeftIcon class="size-4" />Your accessories</Button
			>
			<Button
				variant="ghost"
				size="icon"
				class="-mr-3"
				aria-label="About this wallet"
				onclick={() => (aboutOpen = true)}><InfoIcon class="size-5" /></Button
			>
		</nav>

		{#if !walletStore.address}
			<PageHeader
				title="Passkey wallet"
				body="Your own Revibase wallet, unlocked with Face ID or your fingerprint. Connect it to see what’s in it."
			/>
			<WalletConnect description="Choose Revibase Passkey to open your passkey wallet." />
		{:else if !isPasskey}
			<PageHeader title="Passkey wallet" />
			<Notice
				tone="info"
				title={`${walletStore.walletName ?? 'This wallet'} has its own app`}
				body="This page is only for the Revibase Passkey wallet. Use your wallet’s app to see balances and send."
			/>
			<Button href="/" variant="secondary" size="xl">Back to your accessories</Button>
		{:else if address}
			<h1 class="sr-only">Passkey wallet</h1>
			<List>
				<WalletRow
					{address}
					label="Passkey wallet"
					icon={PASSKEY_WALLET_ICON}
					context="Yours · not tied to an accessory"
					cluster={data.cluster}
					onexport={() =>
						void passkeyWallet()
							?.exportKey()
							.catch(() => {})}
				/>
			</List>

			{#if empty}
				<EmptyState
					title="Nothing here yet"
					body="Receive SOL, tokens or collectibles here. Assets you send to an accessory’s owner also arrive here."
				/>
				<Button size="xl" onclick={() => (receiveOpen = true)}><ArrowDownIcon />Receive</Button>
			{:else}
				<header class="space-y-3 py-3 text-center">
					<p class="text-[12px] text-muted-foreground">Estimated value</p>
					<p
						class="text-[44px] leading-tight font-semibold tracking-[-0.045em] tabular-nums"
						aria-live="polite"
					>
						{valuation?.usd != null ? formatUsd(valuation.usd) : '—'}
					</p>
				</header>
				<div class="grid grid-cols-2 gap-3">
					<Button size="xl" onclick={() => (receiveOpen = true)}><ArrowDownIcon />Receive</Button>
					<Button
						size="xl"
						variant="secondary"
						onclick={() => (sendAllOpen = true)}
						disabled={!sendable}><ArrowUpIcon />Send all</Button
					>
				</div>
			{/if}

			{#if feeShortfall !== null}
				<Notice
					tone="info"
					title="Add a little SOL for network fees"
					body={`Sending from this wallet needs SOL for the network fee. Receive about ${formatTokenAmount(feeShortfall, SOL_DECIMALS)} SOL first.`}
				/>
			{/if}

			{#if holdingsQuery.isError}
				<Notice
					title="Couldn’t load balances"
					onretry={() => void holdingsQuery.refetch()}
					retrying={holdingsQuery.isFetching}
				/>
			{:else if !empty}
				<HoldingsList {holdings} onselect={selectAsset} />
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		{#if address}
			<p class="px-1 text-center text-[13px] leading-relaxed text-muted-foreground">
				Network fees come from this wallet’s SOL. Accessory wallets are separate: open one from its
				accessory.
			</p>
		{/if}
	{/snippet}
</PageShell>

<ResponsiveSheet bind:open={aboutOpen} title="About this wallet">
	<PasskeyWalletExplainer />
	<Button size="xl" onclick={() => (aboutOpen = false)}>Got it</Button>
</ResponsiveSheet>

{#if address}
	<ReceiveSheet
		bind:open={receiveOpen}
		{address}
		cluster={data.cluster}
		description="Receive SOL, tokens and collectibles in your passkey wallet."
	/>
	<PasskeySendSheet bind:open={sendOpen} asset={selectedAsset} {holdings} />
	<PasskeySendAllSheet bind:open={sendAllOpen} {holdings} />
{/if}
