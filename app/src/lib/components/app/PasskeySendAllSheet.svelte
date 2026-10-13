<script lang="ts">
	import { address as toAddress } from '@solana/kit';
	import { toast } from 'svelte-sonner';
	import { createQuery } from '@tanstack/svelte-query';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import AssetChecklist, { selectedAssets } from './AssetChecklist.svelte';
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import Notice from './Notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore } from '$lib/client/wallet/wallet.svelte';
	import {
		estimateSendAllApprovals,
		fetchPasskeyWallet,
		sendAllFromPasskeyWallet
	} from '$lib/client/passkey-wallet/send';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import type { WalletHoldings } from '$lib/shared/wallet-holdings';

	/** Everything in the passkey wallet (or what's left checked) to another wallet. */
	let {
		open = $bindable(false),
		holdings
	}: {
		open?: boolean;
		holdings: WalletHoldings | undefined;
	} = $props();

	const uid = $props.id();
	let recipient = $state('');
	let busy = $state(false);
	let progress = $state('');
	let failure = $state<FriendlyError | null>(null);
	let unchecked = $state<Set<string>>(new Set());
	const selection = $derived(holdings ? selectedAssets(holdings, unchecked) : null);
	const selectedCount = $derived(
		selection
			? (selection.sendSol ? 1 : 0) +
					selection.holdings.tokens.length +
					selection.holdings.nfts.length
			: 0
	);
	const validRecipient = $derived.by(() => {
		try {
			return toAddress(recipient.trim());
		} catch {
			return null;
		}
	});
	const problem = $derived(
		!recipient.trim()
			? null
			: !validRecipient
				? 'Enter a valid Solana address.'
				: validRecipient === walletStore.address
					? 'That’s this wallet.'
					: null
	);
	const approvalQuery = createQuery(() => ({
		queryKey: [
			'passkey-send-all-approvals',
			walletStore.address,
			validRecipient,
			selection?.holdings.tokens.map((t) => [t.tokenAccount, t.amount.toString()]),
			selection?.holdings.nfts.map((n) => n.id),
			holdings?.lamports.toString(),
			selection?.sendSol
		],
		queryFn: () =>
			estimateSendAllApprovals(
				walletStore.address!,
				validRecipient!,
				selection!.holdings,
				selection!.sendSol
			),
		enabled: open && !!walletStore.address && !!validRecipient && !problem && selectedCount > 0,
		staleTime: 15_000,
		retry: false
	}));
	$effect(() => {
		if (!open) {
			failure = null;
			recipient = '';
			unchecked = new Set();
		}
	});

	async function sendAll() {
		if (busy || !selectedCount || !selection || !validRecipient || problem) return;
		const tokenIds = new Set(selection.holdings.tokens.map((t) => t.tokenAccount));
		const nftIds = new Set(selection.holdings.nfts.map((n) => n.id));
		busy = true;
		failure = null;
		progress = 'Preparing…';
		try {
			const ctx = walletStore.signingContext();
			// Re-read balances for retries after a partially completed batch.
			const current = await fetchPasskeyWallet(ctx.address);
			await sendAllFromPasskeyWallet(
				ctx,
				validRecipient,
				{
					...current,
					tokens: current.tokens.filter((t) => tokenIds.has(t.tokenAccount)),
					nfts: current.nfts?.filter((n) => nftIds.has(n.id))
				},
				(done, total) => (progress = `Completed ${done} of ${total}`),
				{ sendSol: selection.sendSol }
			);
			toast.success('Sent to the other wallet');
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
		}
	}
</script>

<ResponsiveSheet
	bind:open
	title="Send all"
	description="Move what’s in your passkey wallet to another wallet you use, like Phantom or Solflare."
>
	<Notice error={failure} />
	<Field label="Send to" id={`${uid}-recipient`}>
		<Input
			id={`${uid}-recipient`}
			bind:value={recipient}
			disabled={busy}
			placeholder="Solana address"
			autocomplete="off"
			autocapitalize="off"
			spellcheck={false}
			aria-invalid={!!problem || undefined}
		/>
	</Field>
	<FieldError message={problem} />
	<AssetChecklist {holdings} bind:unchecked {busy} />
	<p class="flex items-center justify-between px-1 text-[14px]" aria-live="polite">
		<span class="text-muted-foreground">Estimated approvals</span><span
			class="font-medium tabular-nums"
			>{!selectedCount || !validRecipient || problem
				? '—'
				: approvalQuery.isPending
					? 'Calculating…'
					: approvalQuery.isError
						? 'Unavailable'
						: approvalQuery.data}</span
		>
	</p>
	<p class="px-1 text-[13px] leading-relaxed text-muted-foreground">
		Network fees come out of this wallet’s SOL, so SOL is sent last with whatever the fees leave. If
		you stop, completed transfers stay sent.
	</p>
	<Button
		size="xl"
		disabled={busy || !holdings || !selectedCount || !validRecipient || !!problem}
		onclick={sendAll}
		>{#if busy}<Spinner />{progress}{:else}Send {selectedCount}
			{selectedCount === 1 ? 'asset' : 'assets'}{/if}</Button
	>
</ResponsiveSheet>
