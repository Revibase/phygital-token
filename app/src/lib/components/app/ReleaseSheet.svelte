<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import * as Drawer from '$lib/components/ui/drawer';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import WalletPicker from '$lib/components/app/WalletPicker.svelte';
	import WalletChip from '$lib/components/app/WalletChip.svelte';
	import ErrorCard from '$lib/components/app/ErrorCard.svelte';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { releaseAccessory } from '$lib/client/link/flow';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { rememberWallet } from '$lib/client/memory';
	import { shortAddress } from '$lib/shared/encoding';
	import type { AccessoryView } from '$lib/shared/types';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import { toast } from 'svelte-sonner';

	let { accessory, cluster, onreleased }: { accessory: AccessoryView; cluster: Cluster; onreleased?: () => void } = $props();

	let open = $state(false);
	let connecting = $state<string | null>(null);
	let busy = $state(false);
	let failure = $state<FriendlyError | null>(null);

	$effect(() => {
		if (open) walletStore.init(cluster);
	});

	const isLinkedWallet = $derived(walletStore.address === accessory.linkedWallet);

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
	<Drawer.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="lg" class="h-12 rounded-xl"><UnlinkIcon /> Release from wallet</Button>
		{/snippet}
	</Drawer.Trigger>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md space-y-5 px-4 pb-8">
			<Drawer.Header class="px-0 text-left">
				<Drawer.Title>Release this accessory</Drawer.Title>
				<Drawer.Description>
					It will stop representing {accessory.linkedWallet ? shortAddress(accessory.linkedWallet) : 'your wallet'}. Only the
					linked wallet can do this, and it doesn’t need the accessory.
				</Drawer.Description>
			</Drawer.Header>

			{#if failure}<ErrorCard title={failure.title} body={failure.body} detail={failure.detail} />{/if}

			{#if !walletStore.address}
				<!-- Releasing needs no accessory session, so a wallet app can do it from /wallet. -->
				<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/wallet`} />
			{:else}
				<WalletChip address={walletStore.address} label={walletStore.walletName ?? 'Connected wallet'} icon={walletStore.walletIcon} />
				{#if isLinkedWallet}
					<Button size="lg" class="h-14 w-full rounded-xl text-base" disabled={busy} onclick={release}>
						{#if busy}<Spinner /> Approve in your wallet…{:else}Release accessory{/if}
					</Button>
				{:else}
					<p class="text-sm text-muted-foreground">
						This isn’t the linked wallet. Switch to {accessory.linkedWallet ? shortAddress(accessory.linkedWallet) : 'it'} in your
						wallet app.
					</p>
					<Button variant="ghost" class="h-11 w-full" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
				{/if}
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
