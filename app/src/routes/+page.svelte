<script lang="ts">
	import ListRowSkeleton from '#lib/components/app/ListRowSkeleton.svelte';
	import EmptyState from '#lib/components/app/EmptyState.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import AccessoryRow from '#lib/components/app/AccessoryRow.svelte';
	import List from '#lib/components/app/List.svelte';
	import QrCode from '#lib/components/app/QrCode.svelte';
	import Notice from '#lib/components/app/Notice.svelte';
	import PageHeader from '#lib/components/app/PageHeader.svelte';
	import PageShell from '#lib/components/app/PageShell.svelte';
	import WalletConnect from '#lib/components/app/WalletConnect.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { walletAccessoriesQuery } from '#lib/client/queries.ts';
	import { openOwnedAccessory } from '#lib/client/accessory/open-owned.ts';
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
</script>

<svelte:head><title>Your accessories · Revibase</title></svelte:head>

<PageShell size="medium" connect={false}>
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader
			title="Your accessories"
			body={walletStore.address ? undefined : 'Connect a wallet to see the accessories it owns.'}
		/>
		{#if onDesktop}
			<div class="space-y-4 rounded-2xl border bg-card px-5 py-6 text-center">
				<div class="space-y-1">
					<h2 class="text-[17px] font-semibold">Claim on your phone</h2>
					<p class="text-[14px] leading-relaxed text-muted-foreground">
						Claiming uses your phone’s NFC.
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
			<WalletConnect />
		{:else}
			{#if accessories === null && !failure && !listFailure}
				<List>
					{#each [0, 1] as i (i)}<ListRowSkeleton avatar="size-12 rounded-[26%]" detail />{/each}
				</List>
			{:else if accessories?.length === 0 && !onDesktop}
				<EmptyState title="No accessories yet" body="Hold one to your phone to claim it." />
			{:else if accessories?.length}
				<List>
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
		{#if !walletStore.address && !onDesktop}
			<p class="text-center text-[14px] text-muted-foreground">
				Have your accessory? Hold it to your phone.
			</p>
		{/if}
	{/snippet}
</PageShell>
