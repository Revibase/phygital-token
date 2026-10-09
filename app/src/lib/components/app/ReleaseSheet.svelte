<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import List from './List.svelte';
	import Notice from './Notice.svelte';
	import WalletPicker from './WalletPicker.svelte';
	import WalletRow from './WalletRow.svelte';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { releaseAccessory } from '$lib/client/link/flow';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { onMount, untrack } from 'svelte';
	import { platform, isLikelyWalletBrowser } from '$lib/client/capability';
	import { walletDestinationLaunch, type WalletLaunchOptions } from '$lib/client/shortcuts';
	import { shouldChooseWallet, reconcileAccessoryWallet, accessoryLinkContext, accessoryConnectionMethod, accessoryWalletApp, recentWallet, recentConnectionMethod, rememberWallet } from '$lib/client/memory';
	import { shortAddress } from '$lib/shared/encoding';
	import type { AccessoryView } from '$lib/shared/types';
	import { toast } from 'svelte-sonner';

	let {
		accessory,
		cluster,
		open = $bindable(false),
		onreleased
	}: { accessory: AccessoryView; cluster: Cluster; open?: boolean; onreleased?: () => void } = $props();

	let manual = $state(false);
	let launchOptions = $state<WalletLaunchOptions | null>(null);
	onMount(() => {
		reconcileAccessoryWallet(accessory.pda, accessory.owner);
		manual = shouldChooseWallet(accessory.pda) && !isLikelyWalletBrowser();
		const context = accessoryLinkContext(accessory.pda, accessory.owner);
		launchOptions = {
			chooseWallet: shouldChooseWallet(accessory.pda), platform: platform(), inWallet: isLikelyWalletBrowser(), origin: page.url.origin,
			recent: context?.app ?? accessoryWalletApp(accessory.pda, accessory.owner) ?? recentWallet(),
			method: context ? (context.source === 'wallet' ? 'wallet' : 'browser') : accessoryConnectionMethod(accessory.pda, accessory.owner) ?? recentConnectionMethod()
		};
	});
	const unlinkUrl = $derived(`${page.url.origin}/unlink/${encodeURIComponent(accessory.pda)}`);
	const launch = $derived(launchOptions ? walletDestinationLaunch(unlinkUrl, launchOptions) : null);
	const handoff = $derived(launch?.kind === 'link' && launch.href !== unlinkUrl ? launch.href : null);

	let connecting = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (open) untrack(() => { walletStore.init(cluster); if (shouldChooseWallet(accessory.pda) && !isLikelyWalletBrowser()) { manual = true; if (launchOptions) launchOptions = { ...launchOptions, recent: null, method: null, chooseWallet: true }; } });
	});

	const linked = $derived(accessory.owner ? shortAddress(accessory.owner) : 'its wallet');
	const outcome = $derived(`This removes the link to ${linked}. A wallet can be linked again afterward.`);
	const isOwner = $derived(!!walletStore.address && walletStore.address === accessory.owner);

	async function selectManually() {
		if (launchOptions) launchOptions = { ...launchOptions, recent: null, method: null };
		failure = null;
		await walletStore.disconnect();
	}
	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			await walletStore.connect(id);
			manual = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}

	async function release() {
		busy = true;
		failure = null;
		try {
			await releaseAccessory(walletStore.signingContext(), accessory.pda);
			rememberWallet(accessory.pda, null);
			toast.success('Accessory unlinked');
			open = false;
			onreleased ? onreleased() : await invalidateAll();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title="Unlink this accessory?"
	description={outcome}
>
	{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

	{#if !isOwner && handoff}
		<Button href={handoff} size="xl" class="w-full" rel="noopener noreferrer">Open in {launchOptions?.recent ?? 'wallet app'} to unlink</Button>
		<Button variant="ghost" class="w-full" onclick={selectManually}>Use a different wallet</Button>
	{:else if !walletStore.address || manual}
		<WalletPicker label={`Connect ${linked}`} options={walletStore.options} {connecting} onpick={pick} browseTarget={unlinkUrl} />
	{:else}
		<List>
			<WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} {cluster} />
		</List>
		{#if isOwner}
			<Button variant="destructive" size="xl" class="w-full" disabled={busy} onclick={release}>
				{#if busy}<Spinner /> Approve in {walletStore.walletName ?? 'your wallet'}…{:else}Unlink accessory{/if}
			</Button>
			<Button variant="ghost" class="w-full" disabled={busy} onclick={selectManually}>Use a different wallet app</Button>
		{:else}
			<Notice tone="info" title="This isn’t the owner wallet" body={`Switch to ${linked} in your wallet app, then try again.`} />
			<Button variant="secondary" size="xl" class="w-full" onclick={selectManually}>Use a different wallet</Button>
		{/if}
	{/if}
	<Button variant="ghost" class="h-11 w-full text-muted-foreground" onclick={() => (open = false)}>Cancel</Button>
</ResponsiveSheet>
