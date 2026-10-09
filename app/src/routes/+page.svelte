<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AccessoryRow from '$lib/components/app/AccessoryRow.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import PairSheet from '$lib/components/app/PairSheet.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { walletAccessoriesQuery } from '$lib/client/queries';
	import { loginOwner, openOwnedAccessory } from '$lib/client/accessory/open-owned';
	import { rememberRecentWallet } from '$lib/client/memory';
	import { platform } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { AccessoryView } from '$lib/shared/types';

	let { data } = $props();
	let connecting = $state<string | null>(null);
	let failure = $state<FriendlyError | null>(null);
	let releasing = $state<AccessoryView | null>(null);
	let releaseOpen = $state(false);
	let onDesktop = $state(false);
	let pairOpen = $state(false);
	let opening = $state<string | null>(null);

	onMount(() => {
		walletStore.init(data.cluster);
		onDesktop = platform() === 'desktop';
	});

	// Shown from memory instantly on return visits, then revalidated; never persisted (it changes with every link and unlink).
	const listQuery = createQuery(() => ({ ...walletAccessoriesQuery(walletStore.address ?? ''), enabled: !!walletStore.address }));
	const accessories = $derived(walletStore.address ? (listQuery.data ?? null) : null);
	const listFailure = $derived(listQuery.isError && !listQuery.data ? describeError(listQuery.error) : null);
	const reload = () => void listQuery.refetch();

	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
			rememberRecentWallet(walletStore.walletName, 'browser');
			// The one signature: it logs this browser in, so opening accessories never asks again.
			// Declining it cancels the connection and returns to the wallet picker.
			try {
				await loginOwner(walletStore.signingContext());
			} catch (err) {
				await walletStore.disconnect().catch(() => {});
				throw err;
			}
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

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
			? 'Use the Solana wallet you already have to see and manage the accessories linked to it.'
			: accessories === null
				? 'Accessories linked to this wallet.'
				: accessories.length === 1
					? 'One accessory is linked to this wallet.'
					: `${accessories.length === 0 ? 'No' : accessories.length} accessories are linked to this wallet.`
	);
</script>

<svelte:head><title>{walletStore.address ? 'Your accessories' : 'Connect your wallet'} · Revibase</title></svelte:head>

<PageShell size="medium">
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader title={walletStore.address ? 'Your accessories' : 'Connect your wallet'} body={summary} />

		{#if failure ?? listFailure}
			{@const f = (failure ?? listFailure)!}
			<Notice title={f.title} body={f.body} detail={f.detail}>
				{#snippet actions()}
					{#if listFailure && !failure}<Button variant="secondary" class="h-11 w-full" disabled={listQuery.isFetching} onclick={reload}>{listQuery.isFetching ? 'Trying again…' : 'Try again'}</Button>{/if}
				{/snippet}
			</Notice>
		{/if}

		{#if !walletStore.address}
			<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/`} />
			<p class="-mt-4 px-1 text-[13px] leading-snug text-muted-foreground">
				Approve a sign-in message to view your linked accessories.
			</p>
		{:else}
			<List>
				<WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Your wallet'} icon={walletStore.walletIcon} cluster={data.cluster} />
			</List>

			{#if accessories === null && !failure && !listFailure}
				<List label="Accessories">
					{#each [0, 1] as i (i)}
						<li class="flex min-h-14 items-center gap-3 px-4 py-2.5">
							<Skeleton class="size-12 rounded-[26%]" />
							<div class="flex-1 space-y-1.5"><Skeleton class="h-3.5 w-32" /><Skeleton class="h-3 w-20" /></div>
						</li>
					{/each}
				</List>
			{:else if accessories?.length === 0 && !onDesktop}
				<div class="rounded-[14px] bg-muted px-4 py-5 text-center">
					<p class="text-[15px] font-medium">No accessories yet</p>
					<p class="mt-0.5 text-[14px] text-muted-foreground">Tap an accessory to view it and link a wallet.</p>
				</div>
			{:else if accessories?.length === 0}
				<List label="Accessories" footer="You’ll scan a code with your phone and tap the accessory to it.">
					{@render linkRow()}
				</List>
			{:else if accessories}
				<List label="Accessories">
					{#each accessories as acc (acc.pda)}
						<AccessoryRow accessory={acc} busy={opening === acc.pda} onclick={() => openAccessory(acc)}>
							{#snippet trailing()}
								{#if acc.canRelease}
									<Button
										variant="secondary"
										size="sm"
										class="h-11 px-3.5"
										onclick={() => {
											releasing = acc;
											releaseOpen = true;
										}}>Unlink</Button
									>
								{/if}
							{/snippet}
						</AccessoryRow>
					{/each}
					{#if onDesktop}{@render linkRow()}{/if}
				</List>
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		{#if walletStore.address}
			<Button variant="ghost" class="h-11 w-full text-muted-foreground" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
		{:else if !onDesktop}
			<p class="text-center text-[14px] text-muted-foreground">Have your accessory with you? Hold it to your phone instead.</p>
		{/if}
	{/snippet}
</PageShell>

{#snippet linkRow()}
	<ListRow label="Link an accessory" onclick={() => (pairOpen = true)} chevron>
		{#snippet leading()}
			<span class="grid size-12 place-items-center rounded-[26%] bg-muted text-muted-foreground"><PlusIcon class="size-5" /></span>
		{/snippet}
	</ListRow>
{/snippet}

{#if onDesktop && walletStore.address}
	<PairSheet bind:open={pairOpen} onlinked={reload} />
{/if}

{#if releasing}
	<ReleaseSheet accessory={releasing} cluster={data.cluster} bind:open={releaseOpen} onreleased={reload} />
{/if}
