<script lang="ts">
	import ListRowSkeleton from '$lib/components/app/ListRowSkeleton.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import AccessoryRow from '$lib/components/app/AccessoryRow.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import PairSheet from '$lib/components/app/PairSheet.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import WalletConnect from '$lib/components/app/WalletConnect.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { walletAccessoriesQuery } from '$lib/client/queries';
	import { loginOwner, openOwnedAccessory } from '$lib/client/accessory/open-owned';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { platform } from '$lib/client/capability';
	import type { AccessoryView } from '$lib/shared/types';

	let { data } = $props();
	let failure = $state<FriendlyError | null>(null);
	let opening = $state<string | null>(null);
	// A computer can't tap: it claims by pairing with a phone (PairSheet).
	let onDesktop = $state(false);
	let pairOpen = $state(false);

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

		<Notice
			error={failure ?? listFailure}
			onretry={listFailure && !failure ? reload : undefined}
			retrying={listQuery.isFetching}
		/>

		{#if !walletStore.address}
			<WalletConnect afterConnect={login} browseTarget={`${page.url.origin}/`} />
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
				/>
			</List>

			{#if accessories === null && !failure && !listFailure}
				<List label="Accessories">
					{#each [0, 1] as i (i)}<ListRowSkeleton avatar="size-12 rounded-[26%]" detail />{/each}
				</List>
			{:else if accessories?.length === 0 && !onDesktop}
				<EmptyState title="No accessories yet" body="Tap an accessory to view it and claim it." />
			{:else if accessories?.length === 0}
				<List
					label="Accessories"
					footer="You’ll scan a code with your phone and tap the accessory to it."
				>
					{@render claimRow()}
				</List>
			{:else if accessories}
				<List label="Accessories">
					{#each accessories as acc (acc.pda)}
						<AccessoryRow
							accessory={acc}
							busy={opening === acc.pda}
							onclick={() => openAccessory(acc)}
						/>
					{/each}
					{#if onDesktop}{@render claimRow()}{/if}
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

{#snippet claimRow()}
	<ListRow label="Claim an accessory" onclick={() => (pairOpen = true)} chevron>
		{#snippet leading()}
			<span class="grid size-12 place-items-center rounded-[26%] bg-muted text-muted-foreground"
				><PlusIcon class="size-5" /></span
			>
		{/snippet}
	</ListRow>
{/snippet}

{#if onDesktop && walletStore.address}
	<PairSheet bind:open={pairOpen} onlinked={reload} />
{/if}
