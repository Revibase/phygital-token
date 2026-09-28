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

	const copy = $derived.by(() => {
		if (!a) return null;
		if (a.status === 'unavailable') {
			return { title: 'Unavailable', body: 'This accessory’s record is in an unexpected state. Contact the issuer.' };
		}
		if (!a.linkedWallet) {
			return { title: 'Ready to link', body: 'Link a wallet once. After that, a tap is all it takes to sign in.' };
		}
		if (a.kind === 'permanent') {
			return owned
				? { title: 'Permanently yours', body: 'This accessory always signs in as your wallet.' }
				: { title: 'Permanently linked', body: 'This accessory always signs in as the wallet below.' };
		}
		return owned
			? { title: 'Ready to use', body: 'Tap this accessory to sign in as your wallet.' }
			: { title: 'Linked', body: 'This accessory signs in as the wallet below.' };
	});

	const footerNote = $derived(
		!a?.linkedWallet
			? undefined
			: a.kind === 'permanent'
				? 'This link can’t be changed.'
				: a.kind === 'controlled'
					? 'Locked to this wallet. Release it to link a different one.'
					: undefined
	);

	async function retry() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<svelte:head><title>Your accessory · Revibase</title></svelte:head>

<PageShell>
	{#if !a || !copy}
		<section class="flex flex-1 flex-col justify-center">
			<Notice title="Couldn’t load your accessory" body="It’s authentic, but we couldn’t reach the network. Check your connection and try again.">
				{#snippet actions()}
					<Button size="xl" disabled={refreshing} onclick={retry}>{refreshing ? 'Trying again…' : 'Try again'}</Button>
				{/snippet}
			</Notice>
		</section>
	{:else}
		<section class="flex flex-1 flex-col justify-center gap-8 pt-4 pb-10">
			<div class="flex flex-col items-center gap-6">
				<AccessoryMark state="verified" pda={a.pda} hasMint={!!a.mint} />
				<PageHeader align="center" eyebrow={`Verified accessory · ${a.tag}`} eyebrowTone="success" title={copy.title} body={copy.body} />
			</div>

			{#if changedElsewhere}
				<Notice
					tone="info"
					title="Linked to a different wallet"
					body="Since you last used it here, this accessory was linked to another wallet. If that wasn’t you, keep it safe and link it again."
				/>
			{/if}

			{#if a.linkedWallet}
				<List footer={footerNote}>
					<WalletRow address={a.linkedWallet} label={owned ? 'Your wallet' : 'Linked wallet'} icon={owned ? walletStore.walletIcon : null} />
				</List>
			{/if}
		</section>
	{/if}

	{#snippet footer()}
		{#if a}
			{#if a.status === 'ready_to_link'}
				<div class="grid gap-1">
					<Button href="/accessory/link" size="xl" class="w-full">Link wallet</Button>
					<Button variant="ghost" class="h-11 text-muted-foreground" onclick={() => (detailsOpen = true)}>Details</Button>
				</div>
			{:else}
				<List>
					{#if a.canLink}
						<ListRow label="Link a different wallet" href="/accessory/link" chevron />
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
