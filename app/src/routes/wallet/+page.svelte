<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import { getJson } from '$lib/client/api';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import type { AccessoryView } from '$lib/shared/types';

	let { data } = $props();
	let connecting = $state<string | null>(null);
	let accessories = $state<AccessoryView[] | null>(null);
	let failure = $state<FriendlyError | null>(null);
	let releasing = $state<AccessoryView | null>(null);
	let releaseOpen = $state(false);
	const kindLabel = (a: AccessoryView) => (a.kind === 'permanent' ? 'Permanently linked' : a.kind === 'controlled' ? 'Linked · locked' : 'Linked');

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

<svelte:head><title>Lost your accessory? · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col gap-7 pt-4" aria-live="polite">
		<PageHeader
			title="Lost your accessory?"
			body={walletStore.address
				? 'Release an accessory and it stops signing in as your wallet. You don’t need it with you.'
				: 'Connect the wallet it’s linked to. You can release it from there — no accessory needed.'}
		/>

		{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

		{#if !walletStore.address}
			<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/wallet`} />
		{:else}
			<List>
				<WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Your wallet'} icon={walletStore.walletIcon} />
			</List>

			{#if accessories === null && !failure}
				<!-- Same row height as the loaded list, so nothing jumps. -->
				<List label="Your accessories">
					{#each [0, 1] as i (i)}
						<li class="flex min-h-14 items-center gap-3 px-4 py-2.5">
							<Skeleton class="size-12 rounded-[26%]" />
							<div class="flex-1 space-y-1.5"><Skeleton class="h-3.5 w-32" /><Skeleton class="h-3 w-20" /></div>
						</li>
					{/each}
				</List>
			{:else if accessories?.length === 0}
				<div class="rounded-[14px] bg-muted px-4 py-5 text-center">
					<p class="text-[15px] font-medium">No accessories linked</p>
					<p class="mt-0.5 text-[14px] text-muted-foreground">This wallet isn’t linked to any accessory.</p>
				</div>
			{:else if accessories}
				<List label="Your accessories">
					{#each accessories as acc (acc.pda)}
						<ListRow label={`Accessory · ${acc.tag}`} detail={kindLabel(acc)}>
							{#snippet leading()}<AccessoryMark size="sm" />{/snippet}
							{#snippet trailing()}
								{#if acc.canRelease}
									<Button variant="secondary" size="sm" class="h-9 px-3.5" onclick={() => { releasing = acc; releaseOpen = true; }}>Release</Button>
								{/if}
							{/snippet}
						</ListRow>
					{/each}
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

{#if releasing}
	<ReleaseSheet accessory={releasing} cluster={data.cluster} bind:open={releaseOpen} onreleased={() => load(walletStore.address!)} />
{/if}
