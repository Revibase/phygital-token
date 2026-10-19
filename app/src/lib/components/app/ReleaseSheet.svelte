<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Spinner } from '#lib/components/ui/spinner/index.ts';
	import List from './List.svelte';
	import Notice from './Notice.svelte';
	import WalletConnect from './WalletConnect.svelte';
	import WalletRow from './WalletRow.svelte';
	import { walletStore, type Cluster } from '#lib/client/wallet/wallet.svelte.ts';
	import { isConnectedAccessoryOwner } from '#lib/client/accessory/ownership.ts';
	import { releaseAccessory } from '#lib/client/link/flow.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import { untrack } from 'svelte';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import type { AccessoryView } from '#lib/shared/types.ts';
	import { toast } from 'svelte-sonner';

	let {
		accessory,
		cluster,
		open = $bindable(false),
		onreleased
	}: {
		accessory: AccessoryView;
		cluster: Cluster;
		open?: boolean;
		onreleased?: () => void;
	} = $props();

	let choosing = $state(false);
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (open) untrack(() => walletStore.init(cluster));
	});

	const linked = $derived(accessory.owner ? shortAddress(accessory.owner) : 'its owner');
	const isOwner = $derived(isConnectedAccessoryOwner(accessory.owner, walletStore.address));
	const outcome = $derived(
		`${isOwner ? 'You’ll' : `${linked} will`} no longer own it. Anyone can claim it next.`
	);

	async function release() {
		if (!isConnectedAccessoryOwner(accessory.owner, walletStore.address)) {
			failure = describeError(new Error('Connect the accessory owner’s wallet to release it.'));
			return;
		}
		busy = true;
		failure = null;
		try {
			await releaseAccessory(walletStore.signingContext(), accessory.pda);
			toast.success('Accessory released');
			open = false;
			if (onreleased) onreleased();
			else await refreshAll();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet bind:open title="Release this accessory?" description={outcome}>
	<Notice error={failure} />

	<!-- Inside the sheet so it nests; it only accepts the owner's wallet. -->
	<WalletConnect
		bind:open={choosing}
		showButton={!walletStore.address}
		description={accessory.owner ? `Choose the owner’s wallet, ${linked}.` : undefined}
		requireAddress={accessory.owner}
		onconnected={() => (failure = null)}
	/>
	{#if walletStore.address}
		<List>
			<WalletRow address={walletStore.address} label="Your wallet" />
		</List>
		{#if isOwner}
			<Button variant="destructive" size="xl" class="w-full" disabled={busy} onclick={release}>
				{#if busy}<Spinner /> {walletStore.approvePrompt}{:else}Release accessory{/if}
			</Button>
		{:else}
			<Notice
				tone="info"
				title="Not the owner’s wallet"
				body={`Switch to ${linked} to release it.`}
			/>
			<Button variant="secondary" size="xl" class="w-full" onclick={() => (choosing = true)}
				>Use a different wallet</Button
			>
		{/if}
	{/if}
</ResponsiveSheet>
