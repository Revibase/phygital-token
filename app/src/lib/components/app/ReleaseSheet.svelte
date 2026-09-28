<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import * as Drawer from '$lib/components/ui/drawer';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import List from './List.svelte';
	import Notice from './Notice.svelte';
	import WalletPicker from './WalletPicker.svelte';
	import WalletRow from './WalletRow.svelte';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { releaseAccessory } from '$lib/client/link/flow';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { rememberWallet } from '$lib/client/memory';
	import { shortAddress } from '$lib/shared/encoding';
	import type { AccessoryView } from '$lib/shared/types';
	import { toast } from 'svelte-sonner';

	/** Releasing is signed by the linked wallet only; the accessory isn't needed. */
	let {
		accessory,
		cluster,
		open = $bindable(false),
		onreleased
	}: { accessory: AccessoryView; cluster: Cluster; open?: boolean; onreleased?: () => void } = $props();

	let connecting = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (open) walletStore.init(cluster);
	});

	const linked = $derived(accessory.linkedWallet ? shortAddress(accessory.linkedWallet) : 'its wallet');
	const isLinkedWallet = $derived(!!walletStore.address && walletStore.address === accessory.linkedWallet);

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

	async function release() {
		busy = true;
		failure = null;
		try {
			await releaseAccessory(walletStore.signingContext(), accessory.pda);
			rememberWallet(accessory.pda, null);
			toast.success('Accessory released');
			open = false;
			onreleased ? onreleased() : await invalidateAll();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md space-y-5 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<Drawer.Header class="p-0 text-left">
				<Drawer.Title class="text-[20px] font-semibold tracking-[-0.02em]">Release this accessory?</Drawer.Title>
				<Drawer.Description class="text-[14px] leading-snug">
					It will stop signing in as {linked}. Only that wallet can release it — the accessory isn’t needed.
				</Drawer.Description>
			</Drawer.Header>

			{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}

			{#if !walletStore.address}
				<WalletPicker
					label={`Connect ${linked}`}
					options={walletStore.options}
					{connecting}
					onpick={pick}
					browseTarget={`${page.url.origin}/`}
				/>
			{:else}
				<List>
					<WalletRow address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} />
				</List>
				{#if isLinkedWallet}
					<Button variant="destructive" size="xl" class="w-full" disabled={busy} onclick={release}>
						{#if busy}<Spinner /> Approve in {walletStore.walletName ?? 'your wallet'}…{:else}Release accessory{/if}
					</Button>
				{:else}
					<Notice tone="info" title="This isn’t the linked wallet" body={`Switch to ${linked} in your wallet app, then try again.`} />
					<Button variant="secondary" size="xl" class="w-full" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
				{/if}
			{/if}
			<Button variant="ghost" class="h-11 w-full text-muted-foreground" onclick={() => (open = false)}>Cancel</Button>
		</div>
	</Drawer.Content>
</Drawer.Root>
