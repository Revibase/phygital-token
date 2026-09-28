<script lang="ts">
	import { page } from '$app/state';
	import * as Drawer from '$lib/components/ui/drawer';
	import { Button } from '$lib/components/ui/button';
	import Notice from './Notice.svelte';
	import WalletPicker from './WalletPicker.svelte';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { shortAddress } from '$lib/shared/encoding';
	import { toast } from 'svelte-sonner';

	/**
	 * The chain only says which wallet an accessory is linked to. The app says
	 * "yours" only after that wallet is connected here via @solana/connector.
	 */
	let { linkedWallet, cluster, open = $bindable(false) }: { linkedWallet: string; cluster: Cluster; open?: boolean } = $props();

	let connecting = $state<string | null>(null);
	let failure = $state<FriendlyError | null>(null);
	const short = $derived(shortAddress(linkedWallet));
	const mismatch = $derived(!!walletStore.address && walletStore.address !== linkedWallet);

	$effect(() => {
		if (open) walletStore.init(cluster);
	});
	$effect(() => {
		if (open && walletStore.address === linkedWallet) {
			toast.success('Confirmed — this is your wallet');
			open = false;
		}
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
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<div class="mx-auto w-full max-w-md space-y-5 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<Drawer.Header class="p-0 text-left">
				<Drawer.Title class="text-[20px] font-semibold tracking-[-0.02em]">Is {short} yours?</Drawer.Title>
				<Drawer.Description class="text-[14px] leading-snug">Connect that wallet to confirm. Nothing is signed or sent.</Drawer.Description>
			</Drawer.Header>
			{#if failure}<Notice title={failure.title} body={failure.body} detail={failure.detail} />{/if}
			{#if mismatch}
				<Notice tone="info" title="That’s a different wallet" body={`You connected ${shortAddress(walletStore.address!)}. Switch to ${short} in your wallet app.`} />
				<Button variant="secondary" size="xl" class="w-full" onclick={() => walletStore.disconnect()}>Use a different wallet</Button>
			{:else}
				<WalletPicker options={walletStore.options} {connecting} onpick={pick} browseTarget={`${page.url.origin}/wallet`} />
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
