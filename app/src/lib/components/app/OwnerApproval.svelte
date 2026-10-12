<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import WalletConnect from './WalletConnect.svelte';
	import List from './List.svelte';
	import Notice from './Notice.svelte';
	import WalletRow from './WalletRow.svelte';
	import NetworkFeeLine from './NetworkFeeLine.svelte';
	import { passkeyWallet, PASSKEY_WALLET_NAME } from '$lib/client/wallet/secure-signer';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { shortAddress } from '$lib/shared/encoding';
	import type { AccessoryView } from '$lib/shared/types';

	/** Gates owner actions on the connected wallet. `showWallet` also shows that wallet and lets the user switch. */
	let {
		accessory,
		cluster,
		active = true,
		busy = false,
		showWallet = false,
		showFee = true,
		drainsWallet = false,
		action = "approve this transaction",
		children
	}: { accessory: AccessoryView; cluster: Cluster; active?: boolean; busy?: boolean; showWallet?: boolean; showFee?: boolean; drainsWallet?: boolean; action?: string; children: Snippet } = $props();

	let connectOpen = $state(false);
	$effect(() => { if (!active) connectOpen = false; });

	$effect(() => {
		if (active) untrack(() => walletStore.init(cluster));
	});

	const ownerLabel = $derived(accessory.owner ? shortAddress(accessory.owner) : 'its owner');
	const isOwner = $derived(!!walletStore.address && walletStore.address === accessory.owner);

	async function switchWallet() {
		await walletStore.disconnect();
		connectOpen = true;
	}
</script>

{#if walletStore.address}
	{#if showWallet || !isOwner}<List>
		<WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} {cluster} onexport={walletStore.walletName === PASSKEY_WALLET_NAME ? () => void passkeyWallet()?.exportKey().catch(() => {}) : undefined} />
	</List>{/if}
	{#if isOwner}
		{@render children()}
		{#if showFee}<NetworkFeeLine pda={accessory.pda} {drainsWallet} />{/if}
		{#if showWallet}<Button variant="quiet" class="w-full" disabled={busy} onclick={switchWallet}>Use a different wallet</Button>{/if}
	{:else}
		<Notice tone="info" title={`Only the owner can ${action}`} body={`Your connected wallet isn’t the owner. Connect ${ownerLabel} to continue.`} />
		<Button variant="secondary" size="xl" disabled={busy} onclick={switchWallet}>{showWallet ? 'Use a different wallet' : 'Connect as owner'}</Button>
	{/if}
{/if}

<WalletConnect bind:open={connectOpen} showButton={!walletStore.address} disabled={busy} description={`Connect the owner’s wallet (${ownerLabel}) to continue.`} />
