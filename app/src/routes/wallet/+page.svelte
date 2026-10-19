<script lang="ts">
	import { onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Button } from '#lib/components/ui/button/index.ts';
	import HoldingsList from '#lib/components/app/HoldingsList.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import List from '#lib/components/app/List.svelte';
	import Notice from '#lib/components/app/Notice.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import PageShell from '#lib/components/app/PageShell.svelte';
	import ReceiveSheet from '#lib/components/app/ReceiveSheet.svelte';
	import SendSheet from '#lib/components/app/SendSheet.svelte';
	import WalletRow from '#lib/components/app/WalletRow.svelte';
	import { walletHoldingsQuery, walletSetupQuery } from '#lib/client/queries.ts';
	import { describeError } from '#lib/client/link/messages.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { PASSKEY_WALLET_NAME } from '#lib/client/wallet/passkey.svelte.ts';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { formatUsd, portfolioUsd } from '#lib/shared/wallet-holdings.ts';
	import { needsSolForFees, type SendAsset } from '#lib/shared/wallet-transfer.ts';

	let { data } = $props();

	onMount(() => walletStore.init(data.cluster));

	const query = createQuery(() => ({
		...walletHoldingsQuery(walletStore.address ?? ''),
		enabled: !!walletStore.address
	}));
	const holdings = $derived(walletStore.address ? query.data : undefined);
	const failure = $derived(query.isError && !query.data ? describeError(query.error) : null);
	const passkey = $derived(walletStore.walletName === PASSKEY_WALLET_NAME);
	const setupQuery = createQuery(() => ({
		...walletSetupQuery(walletStore.address ?? ''),
		enabled: passkey && !!walletStore.address
	}));
	const setup = $derived(passkey ? (setupQuery.data ?? 0n) : 0n);
	const total = $derived.by(() => {
		if (!holdings) return null;
		const usd = portfolioUsd(holdings);
		return usd !== null
			? formatUsd(usd)
			: `${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`;
	});

	let receiving = $state(false);
	let sending = $state(false);
	let asset = $state<SendAsset>({ kind: 'sol' });
	function startSend(next: SendAsset) {
		asset = next;
		sending = true;
	}
</script>

<svelte:head><title>Wallet · Revibase</title></svelte:head>

<PageShell size="narrow">
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader title="Wallet" body="Send and receive SOL and tokens." />
		{#if walletStore.address}
			<List>
				<WalletRow
					address={walletStore.address}
					label={walletStore.walletName ?? 'Your wallet'}
					icon={walletStore.walletIcon}
					cluster={data.cluster}
				/>
			</List>

			<div class="space-y-1 px-1">
				<p class="text-[13px] font-medium text-muted-foreground">Balance</p>
				{#if total}<p class="text-[32px] leading-tight font-semibold tracking-tight">
						{total}
					</p>{:else}<div class="h-10 w-40 animate-pulse rounded-lg bg-muted"></div>{/if}
			</div>

			<div class="grid grid-cols-2 gap-3">
				<Button size="xl" variant="secondary" onclick={() => (receiving = true)}
					><ArrowDownLeft class="size-4" />Receive</Button
				>
				<Button size="xl" disabled={!holdings} onclick={() => startSend({ kind: 'sol' })}
					><ArrowUpRight class="size-4" />Send</Button
				>
			</div>

			<Notice error={failure} onretry={() => void query.refetch()} retrying={query.isFetching} />
			{#if holdings && needsSolForFees(holdings, passkey, setup)}
				<Notice
					tone="info"
					title={setup ? 'Add SOL to get started' : 'Add a little SOL for network fees'}
					body={setup
						? `Your wallet is set up on its first transaction, which costs about ${formatCompactTokenAmount(setup, SOL_DECIMALS)} SOL once, plus a small network fee. Receive some SOL to begin.`
						: 'Every transfer pays a small network fee in SOL from this wallet. Receive some SOL to send your tokens.'}
				/>
			{/if}

			<HoldingsList {holdings} onselect={startSend} />
		{:else}
			<EmptyState
				title="No wallet connected"
				body="Connect a wallet on the home page to see it here."
			/>
			<Button href="/" variant="secondary" size="xl">Go to home</Button>
		{/if}
	</section>
</PageShell>

{#if walletStore.address}
	<ReceiveSheet bind:open={receiving} address={walletStore.address} cluster={data.cluster} />
	<SendSheet bind:open={sending} {holdings} {asset} cluster={data.cluster} />
{/if}
