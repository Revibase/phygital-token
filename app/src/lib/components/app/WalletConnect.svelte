<script lang="ts">
	import { walletStore } from '#lib/client/wallet/wallet.svelte.ts';
	import { describeError, type FriendlyError } from '#lib/client/link/messages.ts';
	import { rememberRecentWallet } from '#lib/client/memory.ts';
	import { shortAddress } from '#lib/shared/encoding.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import WalletPicker from './WalletPicker.svelte';
	import Notice from './Notice.svelte';

	/**
	 * The one way to connect a wallet: a "Connect wallet" button (optional) and the picker sheet.
	 * Every entry point uses it, so connecting is always the same: pick a wallet, nothing to sign.
	 * `requireAddress` refuses any other wallet; `onconnected` runs once the sheet closes.
	 */
	let {
		open = $bindable(false),
		showButton = true,
		disabled = false,
		description,
		requireAddress = null,
		onconnected
	}: {
		open?: boolean;
		showButton?: boolean;
		disabled?: boolean;
		/** Only when the choice is constrained, e.g. it must be the owner's wallet. */
		description?: string;
		requireAddress?: string | null;
		onconnected?: () => void;
	} = $props();

	let connecting = $state<string | null>(null);
	let failure = $state<FriendlyError | null>(null);

	async function pick(id: string) {
		connecting = id;
		failure = null;
		try {
			if (walletStore.address) await walletStore.disconnect();
			await walletStore.connect(id);
			if (requireAddress && walletStore.address !== requireAddress) {
				await walletStore.disconnect();
				failure = {
					title: 'Not the owner’s wallet',
					body: `Choose ${shortAddress(requireAddress)}.`
				};
				return;
			}
			rememberRecentWallet(walletStore.walletName);
			open = false;
			onconnected?.();
		} catch (err) {
			failure = describeError(err);
		} finally {
			connecting = null;
		}
	}
</script>

{#if showButton}<Button size="xl" {disabled} onclick={() => (open = true)}>Connect wallet</Button
	>{/if}
<ResponsiveSheet bind:open title="Connect wallet" {description}>
	<div class="space-y-4">
		<Notice error={failure} />
		<WalletPicker options={walletStore.options} {connecting} onpick={pick} />
	</div>
</ResponsiveSheet>
