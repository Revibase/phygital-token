<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import { getJson } from '$lib/client/api';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { AccessoryView } from '$lib/shared/types';

	let { data } = $props();
	let connecting = $state<string | null>(null);
	let accessories = $state<AccessoryView[] | null>(null);
	let failure = $state<FriendlyError | null>(null);

	onMount(() => walletStore.init(data.cluster));

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
	});

	async function pick(id: string) {
		connecting = id;
		try {
			await walletStore.connect(id);
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}
</script>

<svelte:head><title>Manage without your accessory</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-6 pt-4">
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold">Lost your accessory?</h1>
			<p class="text-muted-foreground">
				Connect the wallet it’s linked to. You can release it so it no longer represents you — no accessory needed.
			</p>
		</div>

		{#if failure}<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />{/if}

		{#if !walletStore.address}
			<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/wallet`} />
		{:else}
			<WalletChip address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} />
			{#if accessories === null && !failure}
				<Skeleton class="h-24 w-full rounded-2xl" />
			{:else if accessories?.length === 0}
				<p class="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
					No accessories are linked to this wallet.
				</p>
			{:else if accessories}
				<div class="grid gap-3">
					{#each accessories as acc (acc.pda)}
						<Card.Root class="rounded-2xl">
							<Card.Content class="flex flex-row items-center gap-4">
								<AccessoryMark tag={acc.tag} size="sm" state="linked" />
								<div class="min-w-0 flex-1">
									<p class="font-medium">Accessory ••{acc.tag}</p>
									<p class="text-sm text-muted-foreground">
										{acc.kind === 'permanent' ? 'Permanently linked' : acc.isLocked ? 'Linked and locked' : 'Linked'}
									</p>
								</div>
							</Card.Content>
							{#if acc.canRelease}
								<Card.Footer>
									<div class="grid w-full"><ReleaseSheet accessory={acc} cluster={data.cluster} onreleased={() => load(walletStore.address!)} /></div>
								</Card.Footer>
							{/if}
						</Card.Root>
					{/each}
				</div>
			{/if}
			<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
		{/if}
	</section>
</PageShell>
