<script lang="ts">
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import Section from '$lib/components/app/Section.svelte';
	import ListRowSkeleton from '$lib/components/app/ListRowSkeleton.svelte';
	import { onMount } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ResponsiveSheet from '$lib/components/app/ResponsiveSheet.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import CopyField from '$lib/components/app/CopyField.svelte';
	import TokenIcon from '$lib/components/app/TokenIcon.svelte';
	import ReceiveSheet from '$lib/components/app/ReceiveSheet.svelte';
	import AccessoryWalletExplainer from '$lib/components/app/AccessoryWalletExplainer.svelte';
	import { hasSeenWalletIntro, rememberWalletIntro } from '$lib/client/memory';
	import SendAllSheet from '$lib/components/app/SendAllSheet.svelte';
	import {
		isCollectible,
		transferRestriction,
		portfolioValue,
		formatUsd
	} from '$lib/shared/wallet-holdings';
	import {
		collectibleAssets,
		sendAssetRestriction,
		type SendAsset
	} from '$lib/shared/wallet-instructions';
	import SendSheet from '$lib/components/app/SendSheet.svelte';
	import PolicySheet from '$lib/components/app/PolicySheet.svelte';
	import RefillFeesNotice from '$lib/components/app/RefillFeesNotice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { accessoryPolicyQuery, accessoryWalletQuery } from '$lib/client/queries';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';

	let { data } = $props();
	const a = $derived(data.accessory);

	const holdingsQuery = createQuery(() => accessoryWalletQuery(a.pda));
	const policyQuery = createQuery(() => accessoryPolicyQuery(a.pda));
	const holdings = $derived(holdingsQuery.data);
	const valuation = $derived(holdings ? portfolioValue(holdings) : null);
	const policy = $derived(policyQuery.data ?? null);
	const owned = $derived(!!a.owner && walletStore.address === a.owner);
	// Drafts can be prepared before connecting; signatures still require the owner.
	const canPrepare = $derived(!!a.owner && (!walletStore.address || owned));
	// Unclaimed: view only. Whoever claims it next controls what's here, so don't invite deposits.
	const viewOnly = $derived(!a.owner);
	const empty = $derived(
		!!holdings && !holdings.lamports && !holdings.tokens.length && !holdings.nfts?.length
	);
	const showEmpty = $derived(!viewOnly && empty && policyQuery.isSuccess && !policy);

	let receiveOpen = $state(false);
	let sendOpen = $state(false);
	let sendAllOpen = $state(false);
	let selectedAsset = $state<SendAsset>({ kind: 'sol' });
	const tokens = $derived(holdings?.tokens.filter((t) => !isCollectible(t)) ?? []);
	const collectibles = $derived(
		holdings
			? collectibleAssets(holdings)
					.map((asset) =>
						asset.kind === 'token'
							? {
									asset,
									id: asset.token.tokenAccount,
									name: asset.token.name ?? shortAddress(asset.token.mint),
									icon: asset.token.icon,
									restriction: sendAssetRestriction(asset)
								}
							: asset.kind === 'nft'
								? {
										asset,
										id: asset.nft.id,
										name: asset.nft.name ?? shortAddress(asset.nft.id),
										icon: asset.nft.icon,
										restriction: sendAssetRestriction(asset)
									}
								: null
					)
					.filter((nft) => nft !== null)
			: []
	);
	function selectAsset(asset: SendAsset) {
		if (!canPrepare) return;
		selectedAsset = asset;
		sendOpen = true;
	}
	let limitsOpen = $state(false);
	let introOpen = $state(false);

	$effect(() => {
		if (!canPrepare) {
			sendOpen = false;
			sendAllOpen = false;
			limitsOpen = false;
		}
	});

	onMount(() => {
		walletStore.init(data.cluster);
		introOpen = !hasSeenWalletIntro();
		if (introOpen) rememberWalletIntro();
	});

	function refresh() {
		void holdingsQuery.refetch();
		void policyQuery.refetch();
	}
</script>

<svelte:head><title>Accessory wallet · Revibase</title></svelte:head>

<PageShell size="medium">
	<section class="flex flex-1 flex-col gap-6 pt-4 pb-10">
		<nav class="flex items-center justify-between" aria-label="Wallet navigation">
			<Button href={data.accessoryHref} variant="quiet" class="-ml-3 gap-1"
				><ArrowLeftIcon class="size-4" />Back</Button
			>
			<Button
				variant="ghost"
				size="icon"
				class="-mr-3"
				aria-label="About this wallet"
				onclick={() => (introOpen = true)}><InfoIcon class="size-5" /></Button
			>
		</nav>

		<h1 class="sr-only">Accessory wallet</h1>
		{#if showEmpty}
			<EmptyState
				title="Nothing here yet"
				body="This wallet is optional. Send assets here to keep them with the accessory, or turn on tap to sign."
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

			{#if !viewOnly}
				<div class="grid grid-cols-2 gap-3">
					<Button size="xl" onclick={() => (receiveOpen = true)}><ArrowDownIcon />Receive</Button>
					<Button
						size="xl"
						variant="secondary"
						onclick={() => (sendAllOpen = true)}
						disabled={!canPrepare ||
							!holdings ||
							(!holdings.lamports &&
								!holdings.tokens.some((t) => !transferRestriction(t)) &&
								!(holdings.nfts ?? []).some((n) => !n.frozen))}><ArrowUpIcon />Send all</Button
					>
				</div>
			{/if}
		{/if}

		{#if !viewOnly}
			<List>
				<ListRow
					label="Tap to sign transactions"
					detail={policyQuery.isError
						? 'Couldn’t load tap settings'
						: policyQuery.isPending
							? 'Loading…'
							: policy
								? 'On'
								: 'Off · authentication still works'}
					disabled={!canPrepare || policyQuery.isPending || policyQuery.isError}
					onclick={() => (limitsOpen = true)}
					chevron
				/>
			</List>
		{/if}

		{#if viewOnly}
			<Notice
				tone="info"
				title="View only"
				body="This accessory hasn’t been claimed. Whoever claims it will control anything in this wallet."
			/>
			<CopyField value={data.wallet} label="Copy wallet address" mono />
			{#if a.canLink && data.accessoryHref === '/accessory'}<Button href="/accessory/link" size="xl"
					>Claim accessory</Button
				>{/if}
		{:else if walletStore.address && !owned}
			<Notice
				tone="info"
				title="Only the owner can approve transactions"
				body="Your connected wallet isn’t the owner. Sending assets and changing tap settings are disabled. You can still view balances and receive funds."
			/>
		{/if}

		{#if holdingsQuery.isError}
			<Notice
				title="Couldn’t load balances"
				onretry={refresh}
				retrying={holdingsQuery.isFetching}
			/>
		{:else if !showEmpty}
			{#if canPrepare}<p class="px-1 text-[13px] text-muted-foreground">
					Tap an asset to send
				</p>{/if}
			<List label="Tokens">
				{#if !holdings}
					{#each [0, 1] as i (i)}<ListRowSkeleton />{/each}
				{:else}
					<ListRow
						label="Solana"
						detail="SOL"
						value={formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)}
						onclick={viewOnly ? undefined : () => selectAsset({ kind: 'sol' })}
						disabled={!viewOnly && !canPrepare}
						chevron={!viewOnly}
					>
						{#snippet leading()}<TokenIcon src={SOL_INFO.icon} label="SOL" />{/snippet}
					</ListRow>
					{#if !tokens.length}<li class="px-4 py-5 text-[14px] text-muted-foreground">
							{viewOnly ? 'No tokens.' : 'Tokens you receive will appear here.'}
						</li>{/if}
					{#each tokens as t (t.tokenAccount)}
						<ListRow
							label={t.name ?? t.symbol ?? shortAddress(t.mint)}
							detail={!viewOnly && transferRestriction(t)
								? 'Can’t be sent'
								: (t.symbol ?? shortAddress(t.mint))}
							value={formatCompactTokenAmount(t.amount, t.decimals)}
							onclick={viewOnly ? undefined : () => selectAsset({ kind: 'token', token: t })}
							disabled={!viewOnly && !canPrepare}
							chevron={!viewOnly}
						>
							{#snippet leading()}<TokenIcon src={t.icon} label={t.symbol ?? t.mint} />{/snippet}
						</ListRow>
					{/each}
				{/if}
			</List>
		{/if}

		{#if holdings?.nftStatus === 'unavailable' || holdings?.nftStatus === 'partial'}<Notice
				tone="info"
				title="Some collectibles may be missing"
				body="We couldn’t load all your collectibles. Refresh before sending all."
			/>{/if}
		{#if collectibles.length}
			<Section label="Collectibles">
				<div class="grid grid-cols-2 gap-3">
					{#each collectibles as nft (nft.id)}
						{#snippet card()}
							{#if nft.icon}<img
									src={nft.icon}
									alt=""
									class="aspect-square w-full object-cover"
									loading="lazy"
								/>{:else}<div
									class="grid aspect-square place-items-center bg-muted text-4xl text-muted-foreground"
								>
									◇
								</div>{/if}
							<div class="space-y-1 p-3">
								<p class="truncate text-[14px] font-medium">{nft.name}</p>
								{#if nft.restriction && !viewOnly}<p class="text-[12px] text-muted-foreground">
										Can’t be sent yet
									</p>{/if}
							</div>
						{/snippet}
						{#if viewOnly}
							<div class="overflow-hidden rounded-2xl border bg-card">{@render card()}</div>
						{:else}
							<button
								type="button"
								disabled={!canPrepare}
								onclick={() => selectAsset(nft.asset)}
								class="overflow-hidden rounded-2xl border bg-card text-left outline-none transition-colors enabled:hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
								aria-label={`Send ${nft.name}`}>{@render card()}</button
							>
						{/if}
					{/each}
				</div>
			</Section>
		{/if}
		{#if owned}<RefillFeesNotice pda={a.pda} {policy} />{/if}
	</section>
</PageShell>

<ResponsiveSheet bind:open={introOpen} title="About this wallet">
	<AccessoryWalletExplainer bearer={a.kind === 'bearer'} />
	<Button size="xl" onclick={() => (introOpen = false)}>Got it</Button>
</ResponsiveSheet>

<ReceiveSheet bind:open={receiveOpen} address={data.wallet} cluster={data.cluster} />
{#if canPrepare}
	<SendAllSheet bind:open={sendAllOpen} accessory={a} cluster={data.cluster} {holdings} />
	<SendSheet
		asset={selectedAsset}
		bind:open={sendOpen}
		accessory={a}
		cluster={data.cluster}
		{holdings}
	/>
	<PolicySheet bind:open={limitsOpen} accessory={a} cluster={data.cluster} {policy} {holdings} />
{/if}
