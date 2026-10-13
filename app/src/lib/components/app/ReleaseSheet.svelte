<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import Notice from './Notice.svelte';
	import OwnerApproval from './OwnerApproval.svelte';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { releaseAccessory } from '$lib/client/link/flow';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { rememberWallet } from '$lib/client/memory';
	import { accessoryWalletQuery } from '$lib/client/queries';
	import { sweepToOwner } from '$lib/client/accessory-wallet/send';
	import { describeHoldings } from '$lib/shared/wallet-holdings';
	import { shortAddress } from '$lib/shared/encoding';
	import type { AccessoryView } from '$lib/shared/types';
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

	let busy = $state(false);
	let moving = $state<string | null>(null);
	let failure = $state<FriendlyError | null>(null);

	const holdingsQuery = createQuery(() => ({
		...accessoryWalletQuery(accessory.pda),
		enabled: open
	}));
	const held = $derived(holdingsQuery.data ? describeHoldings(holdingsQuery.data) : null);

	const linked = $derived(accessory.owner ? shortAddress(accessory.owner) : 'its owner');
	const outcome = $derived(
		`This removes ${linked} as the owner. Someone else can claim it afterward. Assets stay in the accessory wallet and the next owner gains control.`
	);

	async function release() {
		busy = true;
		failure = null;
		try {
			await releaseAccessory(walletStore.signingContext(), accessory.pda);
			rememberWallet(accessory.pda, null);
			toast.success('Accessory released');
			open = false;
			if (onreleased) onreleased();
			else await invalidateAll();
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}

	async function moveToOwner() {
		if (!holdingsQuery.data) return;
		busy = true;
		failure = null;
		moving = 'Preparing…';
		try {
			await sweepToOwner(
				walletStore.signingContext(),
				accessory.pda,
				holdingsQuery.data,
				(done, total) => (moving = `Moved ${done} of ${total}`)
			);
			toast.success('Assets sent to owner');
			await holdingsQuery.refetch();
		} catch (err) {
			failure = describeError(err);
			await holdingsQuery.refetch();
		} finally {
			busy = false;
			moving = null;
		}
	}
</script>

<ResponsiveSheet bind:open title="Release this accessory?" description={outcome}>
	<Notice error={failure} />
	<OwnerApproval
		action="release this accessory"
		{accessory}
		{cluster}
		active={open}
		{busy}
		showWallet
	>
		{#if held}
			<Notice
				tone="info"
				title={`This accessory wallet holds ${held}`}
				body="Assets stay here. Whoever claims it next will control them."
			/>
			<Button size="xl" disabled={busy} onclick={moveToOwner}>
				{#if moving}<Spinner /> {moving}{:else}Move everything to owner first{/if}
			</Button>
		{/if}
		<Button variant="destructive" size="xl" disabled={busy} onclick={release}>
			{#if busy && !moving}<Spinner /> {walletStore.approvePrompt}{:else}{held
					? 'Release anyway'
					: 'Release accessory'}{/if}
		</Button>
	</OwnerApproval>
	<Button variant="quiet" class="w-full" onclick={() => (open = false)}>Cancel</Button>
</ResponsiveSheet>
