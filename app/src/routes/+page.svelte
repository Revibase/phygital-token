<script lang="ts">
	import ListRowSkeleton from '#lib/components/app/ListRowSkeleton.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.ts';
	import AccessoryRow from '#lib/components/app/AccessoryRow.svelte';
	import List from '#lib/components/app/List.svelte';
	import QrCode from '#lib/components/app/QrCode.svelte';
	import Notice from '#lib/components/app/Notice.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import PageShell from '#lib/components/app/PageShell.svelte';
	import WalletConnect from '#lib/components/app/WalletConnect.svelte';
	import WalletRow from '#lib/components/app/WalletRow.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { walletAccessoriesQuery, walletHoldingsQuery } from '#lib/client/queries.ts';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '#lib/shared/amount.ts';
	import { formatUsd, portfolioUsd } from '#lib/shared/wallet-holdings.ts';
	import { loginOwner, openOwnedAccessory } from '#lib/client/accessory/open-owned.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { platform } from '#lib/client/capability.ts';
	import type { AccessoryView } from '#lib/shared/types.ts';

	let { data } = $props();
	let failure = $state<FriendlyError | null>(null);
	let opening = $state<string | null>(null);
	let onDesktop = $state(false);

	onMount(() => {
		walletStore.init(data.cluster);
		onDesktop = platform() === 'desktop';
	});

	// Shown from memory instantly on return visits, then revalidated; never persisted (it changes with every link and unlink).
	const listQuery = createQuery(() => ({
		...walletAccessoriesQuery(walletStore.address ?? ''),
		enabled: !!walletStore.address
	}));
	const accessories = $derived(walletStore.address ? (listQuery.data ?? null) : null);
	const listFailure = $derived(
		listQuery.isError && !listQuery.data ? describeError(listQuery.error) : null
	);
	const reload = () => void listQuery.refetch();

	// The wallet row shows what it holds and opens the wallet page.
	const holdingsQuery = createQuery(() => ({
		...walletHoldingsQuery(walletStore.address ?? ''),
		enabled: !!walletStore.address
	}));
	const balance = $derived.by(() => {
		const holdings = walletStore.address ? holdingsQuery.data : undefined;
		if (!holdings) return undefined;
		const usd = portfolioUsd(holdings);
		return usd !== null
			? formatUsd(usd)
			: `${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`;
	});

	// The one signature: it logs this browser in, so opening accessories never asks again.
	// Declining it cancels the connection and returns to the wallet picker.
	const login = () => loginOwner(walletStore.signingContext());

	async function openAccessory(acc: AccessoryView) {
		opening = acc.pda;
		failure = null;
		try {
			await openOwnedAccessory(acc.pda);
		} catch (err) {
			failure = describeError(err);
		} finally {
			opening = null;
		}
	}

	// Show wallet linkage separately from physical ownership.
	const summary = $derived(
		!walletStore.address
			? 'Connect a wallet to see and manage the accessories linked to it.'
			: accessories === null
				? 'Accessories linked to this wallet.'
				: accessories.length === 1
					? 'One accessory is linked to this wallet.'
					: `${accessories.length === 0 ? 'No' : accessories.length} accessories are linked to this wallet.`
	);
</script>

<svelte:head
	><title>{walletStore.address ? 'Your accessories' : 'Connect your wallet'} · Revibase</title
	></svelte:head
>

<PageShell size="medium">
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader
			title={walletStore.address ? 'Your accessories' : 'Connect your wallet'}
			body={summary}
		/>
		{#if onDesktop}
			<div class="space-y-4 rounded-2xl border bg-card px-5 py-6 text-center">
				<div class="space-y-1">
					<h2 class="text-[17px] font-semibold">Continue on your phone</h2>
					<p class="text-[14px] leading-relaxed text-muted-foreground">
						Scan to open Revibase, then tap your accessory to claim it.
					</p>
				</div>
				<QrCode value={page.url.origin} label="Scan with your phone’s camera" />
			</div>
		{/if}

		<Notice
			error={failure ?? listFailure}
			onretry={listFailure && !failure ? reload : undefined}
			retrying={listQuery.isFetching}
		/>

		{#if !walletStore.address}
			<WalletConnect afterConnect={login} />
			<p class="-mt-4 px-1 text-[13px] leading-snug text-muted-foreground">
				Approve a sign-in message to view your linked accessories.
			</p>
		{:else}
			<List>
				<WalletRow
					address={walletStore.address}
					label={walletStore.walletName ?? 'Your wallet'}
					icon={walletStore.walletIcon}
					cluster={data.cluster}
					href="/wallet"
					value={balance}
				/>
			</List>

			{#if accessories === null && !failure && !listFailure}
				<List label="Accessories">
					{#each [0, 1] as i (i)}<ListRowSkeleton avatar="size-12 rounded-[26%]" detail />{/each}
				</List>
			{:else if accessories?.length === 0 && !onDesktop}
				<EmptyState title="No accessories yet" body="Tap an accessory to view it and claim it." />
			{:else if accessories?.length}
				<List label="Accessories">
					{#each accessories as acc (acc.pda)}
						<AccessoryRow
							accessory={acc}
							busy={opening === acc.pda}
							onclick={() => openAccessory(acc)}
						/>
					{/each}
				</List>
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		{#if walletStore.address}
			<Button variant="quiet" class="w-full" onclick={() => walletStore.disconnect()}
				>Use a different wallet</Button
			>
		{:else if !onDesktop}
			<p class="text-center text-[14px] text-muted-foreground">
				Have your accessory with you? Hold it to your phone instead.
			</p>
		{/if}
	{/snippet}
</PageShell>
