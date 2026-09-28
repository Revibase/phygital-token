<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AccessoryRow from '$lib/components/app/AccessoryRow.svelte';
	import List from '$lib/components/app/List.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { getJson } from '$lib/client/api';
	import { platform } from '$lib/client/capability';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { AccessoryView } from '$lib/shared/types';

	/**
	 * Home = your wallet's accessories. People holding an accessory never land
	 * here: a tap goes straight to /accessory (this route's server load handles
	 * the tap URL and redirects). This page is for signing in with the wallet
	 * itself — see every linked accessory and release any of them, no
	 * accessory required.
	 */
	let { data } = $props();
	let connecting = $state<string | null>(null);
	let accessories = $state<AccessoryView[] | null>(null);
	let failure = $state<FriendlyError | null>(null);
	let releasing = $state<AccessoryView | null>(null);
	let releaseOpen = $state(false);
	let onDesktop = $state(false);

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

	const summary = $derived(
		!walletStore.address
			? 'Connect your wallet to see the accessories that sign in as it.'
			: accessories === null
				? 'Accessories that sign in as this wallet.'
				: accessories.length === 1
					? 'One accessory signs in as this wallet.'
					: `${accessories.length === 0 ? 'No' : accessories.length} accessories sign in as this wallet.`
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
			{:else if accessories?.length === 0}
				<div class="rounded-[14px] bg-muted px-4 py-5 text-center">
					<p class="text-[15px] font-medium">No accessories yet</p>
					<p class="mt-0.5 text-[14px] text-muted-foreground">Hold an accessory to your phone to link it to this wallet.</p>
				</div>
			{:else if accessories}
				<List label="Accessories" footer="Releasing an accessory stops it signing in as this wallet. You don’t need it with you.">
					{#each accessories as acc (acc.pda)}
						<AccessoryRow accessory={acc}>
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
				</List>
			{/if}
		{/if}
	</section>

	{#snippet footer()}
		<div class="grid gap-1">
			{#if onDesktop}
				<Button href="/link" variant="secondary" size="xl" class="w-full">Link an accessory from this computer</Button>
			{/if}
			{#if walletStore.address}
				<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
			{/if}
		</div>
	{/snippet}
</PageShell>

{#if releasing}
	<ReleaseSheet accessory={releasing} cluster={data.cluster} bind:open={releaseOpen} onreleased={() => load(walletStore.address!)} />
{/if}
