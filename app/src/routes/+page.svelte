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
	import { getJson } from '$lib/client/api';
	import { openOwnedAccessory } from '$lib/client/accessory/open-owned';
	import { platform } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { AccessoryView } from '$lib/shared/types';

	/**
	 * Home = your wallet's accessories. People holding an accessory never land
	 * here: a tap goes straight to /accessory (this route's server load handles
	 * the tap URL and redirects). This page is for signing in with the wallet
	 * itself — see every linked accessory and release any of them, no
	 * accessory required. Opening a row mints owner_browse and goes to /accessory.
	 */
	let { data } = $props();
	let connecting = $state<string | null>(null);
	let accessories = $state<AccessoryView[] | null>(null);
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

	async function load(address: string) {
		accessories = null;
		failure = null;
		try {
			accessories = (await getJson<{ accessories: AccessoryView[] }>(`/api/wallet/${address}/accessories`)).accessories;
		} catch (err) {
			failure = describeError(err);
		}
	}

	$effect(() => {
		if (walletStore.address) void load(walletStore.address);
		else accessories = null;
	});

	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
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

	// "Linked", not "signs in as": tradable (Bearer) accessories are collectibles, not keys.
	const summary = $derived(
		!walletStore.address
			? 'Connect your wallet to see the accessories linked to it.'
			: accessories === null
				? 'Accessories linked to this wallet.'
				: accessories.length === 1
					? 'One accessory is linked to this wallet.'
					: `${accessories.length === 0 ? 'No' : accessories.length} accessories are linked to this wallet.`
	);
</script>

<PageShell>
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader title="Your accessories" body={summary} />

		{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

		{#if !walletStore.address}
			<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/`} />
			{#if !onDesktop}
				<p class="px-1 text-[13px] text-muted-foreground">Have your accessory with you? Hold it to your phone instead.</p>
			{/if}
		{:else}
			<!-- Connected via @solana/connector, so this wallet is provably the viewer's. -->
			<List>
				<WalletRow address={walletStore.address} label="Your wallet" icon={walletStore.walletIcon} />
			</List>

			{#if accessories === null && !failure}
				<!-- Same row height as the loaded list, so nothing jumps. -->
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
					<p class="mt-0.5 text-[14px] text-muted-foreground">Hold an accessory to your phone to make it yours.</p>
				</div>
			{:else if accessories?.length === 0}
				<List label="Accessories" footer="You’ll scan a code with your phone and tap the accessory to it.">
					{@render linkRow()}
				</List>
			{:else if accessories}
				<List label="Accessories" footer="Releasing unlinks an accessory from this wallet, so whoever holds it next can make it theirs. You don’t need it with you.">
					{#each accessories as acc (acc.pda)}
						<AccessoryRow accessory={acc} busy={opening === acc.pda} onclick={() => openAccessory(acc)}>
							{#snippet trailing()}
								{#if acc.canRelease}
									<Button
										variant="secondary"
										size="sm"
										class="h-9 px-3.5"
										onclick={() => {
											releasing = acc;
											releaseOpen = true;
										}}>Release</Button
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
		{/if}
	{/snippet}
</PageShell>

<!-- Computers only: the tap happens on a phone, so the phone scans a code shown here. -->
{#snippet linkRow()}
	<ListRow label="Link an accessory" onclick={() => (pairOpen = true)} chevron>
		{#snippet leading()}
			<span class="grid size-12 place-items-center rounded-[26%] bg-muted text-muted-foreground"><PlusIcon class="size-5" /></span>
		{/snippet}
	</ListRow>
{/snippet}

{#if onDesktop && walletStore.address}
	<PairSheet bind:open={pairOpen} onlinked={() => load(walletStore.address!)} />
{/if}

{#if releasing}
	<ReleaseSheet accessory={releasing} cluster={data.cluster} bind:open={releaseOpen} onreleased={() => load(walletStore.address!)} />
{/if}
