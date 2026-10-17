<script lang="ts">
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { ApiClientError } from '$lib/client/api';
	import { rememberRecentWallet } from '$lib/client/memory';
	import { shortAddress } from '$lib/shared/encoding';
	import { Button } from '$lib/components/ui/button';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import WalletPicker from './WalletPicker.svelte';
	import Notice from './Notice.svelte';

	/**
	 * The one way to connect a wallet: a "Connect wallet" button (optional) and the picker sheet.
	 * `requireAddress` refuses any other wallet; `afterConnect` runs before the sheet closes
	 * (a failure disconnects again); `onconnected` runs once it has.
	 */
	let {
		open = $bindable(false),
		showButton = true,
		disabled = false,
		description = 'Choose a wallet to continue.',
		requireAddress = null,
		afterConnect,
		onconnected
	}: {
		open?: boolean;
		showButton?: boolean;
		disabled?: boolean;
		description?: string;
		requireAddress?: string | null;
		afterConnect?: () => Promise<void>;
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
					title: 'That’s not the owner’s wallet',
					body: `Choose the wallet that owns this accessory (${shortAddress(requireAddress)}).`
				};
				return;
			}
			try {
				await afterConnect?.();
			} catch (err) {
				// A dropped request (offline, or Safari aborting it as the page reloads) isn't a refusal:
				// keep the wallet. Anything that still needs a session asks again.
				const dropped = err instanceof ApiClientError && err.status === 0;
				if (!dropped) await walletStore.disconnect().catch(() => {});
				throw err;
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
		<WalletPicker
			label="Choose a wallet"
			options={walletStore.options}
			{connecting}
			onpick={pick}
		/>
	</div>
</ResponsiveSheet>
