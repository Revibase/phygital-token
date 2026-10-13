<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import List from './List.svelte';
	import WalletRow from './WalletRow.svelte';
	import AssetChecklist, { selectedAssets } from './AssetChecklist.svelte';
	import Notice from './Notice.svelte';
	import OwnerApproval from './OwnerApproval.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { sweepToOwner, estimateSweepApprovals } from '$lib/client/accessory-wallet/send';
	import { fetchAccessoryWallet } from '$lib/client/accessory-wallet/holdings';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { PASSKEY_WALLET_NAME } from '$lib/client/wallet/secure-signer';
	import type { WalletHoldings } from '$lib/shared/wallet-holdings';
	import type { AccessoryView } from '$lib/shared/types';

	let {
		open = $bindable(false),
		accessory,
		cluster,
		holdings,
		onsent
	}: {
		open?: boolean;
		accessory: AccessoryView;
		cluster: Cluster;
		holdings: WalletHoldings | undefined;
		onsent?: () => void;
	} = $props();
	let busy = $state(false);
	let progress = $state('');
	let failure = $state<FriendlyError | null>(null);
	let unchecked = $state<Set<string>>(new Set());
	const selection = $derived(holdings ? selectedAssets(holdings, unchecked) : null);
	const selectedHoldings = $derived(selection?.holdings ?? null);
	const sendSol = $derived(selection?.sendSol ?? false);
	const selectedCount = $derived(
		(sendSol ? 1 : 0) +
			(selectedHoldings?.tokens.length ?? 0) +
			(selectedHoldings?.nfts.length ?? 0)
	);
	// The owner may be the connected passkey wallet: name it the way its own page does.
	const toPasskeyWallet = $derived(
		walletStore.address === accessory.owner && walletStore.walletName === PASSKEY_WALLET_NAME
	);
	const approvalQuery = createQuery(() => ({
		queryKey: [
			'sweep-approvals',
			accessory.pda,
			accessory.owner,
			selectedHoldings?.tokens.map((t) => [t.tokenAccount, t.amount.toString()]),
			selectedHoldings?.nfts.map((n) => n.id),
			holdings?.lamports.toString(),
			sendSol
		],
		queryFn: () =>
			estimateSweepApprovals(accessory.owner!, accessory.pda, selectedHoldings!, sendSol),
		enabled: open && !!accessory.owner && !!selectedHoldings && selectedCount > 0,
		staleTime: 15_000,
		retry: false
	}));
	$effect(() => {
		if (!open) {
			failure = null;
			unchecked = new Set();
		}
	});

	async function sendAll() {
		if (busy || !selectedCount || !selectedHoldings) return;
		const tokenIds = new Set(selectedHoldings.tokens.map((t) => t.tokenAccount));
		const nftIds = new Set(selectedHoldings.nfts.map((n) => n.id));
		busy = true;
		failure = null;
		progress = 'Preparing…';
		try {
			// Re-read balances for retries after a partially completed batch.
			const current = await fetchAccessoryWallet(accessory.pda);
			await sweepToOwner(
				walletStore.signingContext(),
				accessory.pda,
				{
					...current,
					tokens: current.tokens.filter((t) => tokenIds.has(t.tokenAccount)),
					nfts: current.nfts?.filter((n) => nftIds.has(n.id))
				},
				(done, total) => (progress = `Completed ${done} of ${total}`),
				{ sendSol }
			);
			toast.success(
				toPasskeyWallet ? 'Sent to your passkey wallet' : 'Selected assets sent to owner'
			);
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
			onsent?.();
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title="Send all to owner"
	description="Choose which assets to send to the owner."
>
	<Notice error={failure} />
	<List label="Send to">
		<WalletRow
			address={accessory.owner!}
			label={toPasskeyWallet ? 'Your passkey wallet' : 'Owner'}
			icon={toPasskeyWallet ? walletStore.walletIcon : null}
			context="Manages this accessory"
			{cluster}
		/>
	</List>
	<AssetChecklist {holdings} bind:unchecked {busy} />
	<p class="flex items-center justify-between px-1 text-[14px]" aria-live="polite">
		<span class="text-muted-foreground">Estimated approvals</span><span
			class="font-medium tabular-nums"
			>{!selectedCount
				? 0
				: approvalQuery.isPending
					? 'Calculating…'
					: approvalQuery.isError
						? 'Unavailable'
						: approvalQuery.data}</span
		>
	</p>
	<p class="px-1 text-[13px] leading-relaxed text-muted-foreground">
		The estimate may change. If you stop, completed transfers stay sent. SOL is sent last, after
		fees and any required fee top-up.
	</p>
	<OwnerApproval action="send these assets" {accessory} {cluster} active={open} {busy}>
		<Button size="xl" disabled={busy || !holdings || !selectedCount} onclick={sendAll}
			>{#if busy}<Spinner />{progress}{:else}Send {selectedCount}
				{selectedCount === 1 ? 'asset' : 'assets'} to owner{/if}</Button
		>
	</OwnerApproval>
</ResponsiveSheet>
