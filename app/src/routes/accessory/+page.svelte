<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import List from '$lib/components/app/List.svelte';
	import ListRow from '$lib/components/app/ListRow.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import ReleaseSheet from '$lib/components/app/ReleaseSheet.svelte';
	import TechnicalDetails from '$lib/components/app/TechnicalDetails.svelte';
	import WalletRow from '$lib/components/app/WalletRow.svelte';
	import { rememberedWallet } from '$lib/client/memory';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { changedElsewhereNotice, tapScreen } from '$lib/client/accessory/screen';

	let { data } = $props();
	const a = $derived(data.accessory);

	let detailsOpen = $state(false);
	let releaseOpen = $state(false);
	let refreshing = $state(false);

	// Silent reconnect only: if this browser already connected a wallet via
	// @solana/connector, we can tell whether the linked wallet is the viewer's.
	onMount(() => walletStore.init(data.cluster));

	/** "Yours" is claimed only when the linked wallet is connected here. */
	const owned = $derived(!!a?.linkedWallet && walletStore.address === a.linkedWallet);

	// "Linked wallet changed" is only knowable against what this device linked before.
	let remembered = $state<string | null>(null);
	$effect(() => {
		if (a) remembered = rememberedWallet(a.pda);
	});
	const changedElsewhere = $derived(!!a?.linkedWallet && !!remembered && remembered !== a.linkedWallet);

	const screen = $derived(a ? tapScreen(a, owned) : null);

	async function retry() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<svelte:head><title>Your accessory · Revibase</title></svelte:head>

<PageShell>
	{#if !a || !screen}
		<section class="flex flex-1 flex-col justify-center">
			<Notice title="Couldn’t load this accessory" body="It’s genuine, but we couldn’t reach the network to load it. Check your connection and try again.">
				{#snippet actions()}
					<Button size="xl" disabled={refreshing} onclick={retry}>{refreshing ? 'Trying again…' : 'Try again'}</Button>
				{/snippet}
			</Notice>
		</section>
	{:else}
		<section class="flex flex-1 flex-col justify-center gap-8 pt-4 pb-10">
			<div class="flex flex-col items-center gap-6">
				<AccessoryMark state="verified" pda={a.pda} hasMint={!!a.mint} />
				<PageHeader align="center" eyebrow={`Genuine · ${a.tag}`} eyebrowTone="success" title={screen.title} body={screen.body} />
			</div>

			{#if changedElsewhere}
				<Notice tone="info" {...changedElsewhereNotice(a)} />
			{/if}

			{#if a.linkedWallet && screen.walletLabel}
				<List footer={screen.footnote}>
					<WalletRow address={a.linkedWallet} label={screen.walletLabel} icon={owned ? walletStore.walletIcon : null} />
				</List>
			{/if}
		</section>
	{/if}

	{#snippet footer()}
		{#if a && screen}
			{#if screen.claim}
				<div class="grid gap-1">
					<Button href="/accessory/link" size="xl" class="w-full">Make it yours</Button>
					<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => (detailsOpen = true)}>Details</Button>
				</div>
			{:else}
				<List>
					{#if screen.move}
						<ListRow label="Move to another wallet" href="/accessory/link" chevron />
					{/if}
					{#if a.canRelease}
						<ListRow label="Release from wallet" onclick={() => (releaseOpen = true)} chevron />
					{/if}
					<ListRow label="Details" onclick={() => (detailsOpen = true)} chevron />
				</List>
			{/if}
			<TechnicalDetails accessory={a} cluster={data.cluster} bind:open={detailsOpen} />
			{#if a.canRelease}<ReleaseSheet accessory={a} cluster={data.cluster} bind:open={releaseOpen} />{/if}
		{/if}
	{/snippet}
</PageShell>
