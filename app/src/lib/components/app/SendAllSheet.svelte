<script lang="ts">
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import { toast } from 'svelte-sonner';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletRow from './WalletRow.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import Notice from './Notice.svelte';
	import OwnerApproval from './OwnerApproval.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { walletStore, type Cluster } from '$lib/client/wallet/wallet.svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { sweepToOwner, estimateSweepApprovals } from '$lib/client/accessory-wallet/send';
	import { fetchAccessoryWallet } from '$lib/client/accessory-wallet/holdings';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';
	import { isCollectible, transferRestriction, type WalletHoldings } from '$lib/shared/wallet-holdings';
	import type { AccessoryView } from '$lib/shared/types';

	let { open = $bindable(false), accessory, cluster, holdings, onsent }: {
		open?: boolean; accessory: AccessoryView; cluster: Cluster; holdings: WalletHoldings | undefined; onsent?: () => void;
	} = $props();
	let busy = $state(false);
	let progress = $state('');
	let failure = $state<FriendlyError | null>(null);
	const sendable = $derived(holdings?.tokens.filter((t) => !transferRestriction(t)) ?? []);
	const excluded = $derived(holdings?.tokens.filter((t) => transferRestriction(t)) ?? []);
	const nfts = $derived(holdings?.nfts?.filter((n) => !n.frozen) ?? []);
	const frozenNfts = $derived(holdings?.nfts?.filter((n) => n.frozen) ?? []);
	let unchecked = $state<Set<string>>(new Set());
	const sendSol = $derived(!!holdings?.lamports && !unchecked.has('sol'));
	const selectedHoldings = $derived(holdings ? { ...holdings, tokens: sendable.filter((t) => !unchecked.has(t.tokenAccount)), nfts: nfts.filter((n) => !unchecked.has(n.id)) } : null);
	const selectedCount = $derived((sendSol ? 1 : 0) + (selectedHoldings?.tokens.length ?? 0) + (selectedHoldings?.nfts.length ?? 0));
	const approvalQuery = createQuery(() => ({
		queryKey: ['sweep-approvals', accessory.pda, accessory.owner, selectedHoldings?.tokens.map((t) => [t.tokenAccount, t.amount.toString()]), selectedHoldings?.nfts.map((n) => n.id), holdings?.lamports.toString(), sendSol],
		queryFn: () => estimateSweepApprovals(accessory.owner!, accessory.pda, selectedHoldings!, sendSol),
		enabled: open && !!accessory.owner && !!selectedHoldings && selectedCount > 0,
		staleTime: 15_000,
		retry: false
	}));
	function toggle(id: string) {
		if (busy) return;
		const next = new Set(unchecked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		unchecked = next;
	}
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
			await sweepToOwner(walletStore.signingContext(), accessory.pda, { ...current, tokens: current.tokens.filter(t => tokenIds.has(t.tokenAccount)), nfts: current.nfts?.filter(n => nftIds.has(n.id)) }, (done, total) => progress = `Completed ${done} of ${total}`, { sendSol });
			toast.success('Selected assets sent to owner');
			open = false;
		} catch (err) {
			failure = describeError(err);
		} finally {
			busy = false;
			onsent?.();
		}
	}
</script>

<ResponsiveSheet bind:open title="Send all to owner" description="Choose which assets to send to the owner.">
	<Notice error={failure} />
	<List label="Send to">
		<WalletRow address={accessory.owner!} label="Owner" context="Manages this accessory" {cluster} />
	</List>
	<List label="Assets to send">
		{#if holdings?.lamports}
			<ListRow label="Solana" value={`${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`} selectable>
				{#snippet leading()}<span class="flex items-center gap-1"><Checkbox class="-ml-2" checked={!unchecked.has('sol')} disabled={busy} onCheckedChange={() => toggle('sol')} /><TokenIcon src={SOL_INFO.icon} label="SOL" /></span>{/snippet}
			</ListRow>
		{/if}
		{#each sendable as token (token.tokenAccount)}
			{@const name = token.name ?? token.symbol ?? shortAddress(token.mint)}
			<ListRow label={name} value={`${isCollectible(token) ? '1' : formatCompactTokenAmount(token.amount, token.decimals)}${token.symbol ? ` ${token.symbol}` : isCollectible(token) ? ' NFT' : ''}`} selectable>
				{#snippet leading()}<span class="flex items-center gap-1"><Checkbox class="-ml-2" checked={!unchecked.has(token.tokenAccount)} disabled={busy} onCheckedChange={() => toggle(token.tokenAccount)} /><TokenIcon src={token.icon} label={name} /></span>{/snippet}
			</ListRow>
		{/each}
		{#each nfts as nft (nft.id)}
			{@const name = nft.name ?? shortAddress(nft.id)}
			<ListRow label={name} value={`1 ${nft.symbol ?? 'NFT'}`} selectable>
				{#snippet leading()}<span class="flex items-center gap-1"><Checkbox class="-ml-2" checked={!unchecked.has(nft.id)} disabled={busy} onCheckedChange={() => toggle(nft.id)} /><TokenIcon src={nft.icon} label={name} /></span>{/snippet}
			</ListRow>
		{/each}
	</List>
	{#if holdings?.nftStatus === 'unavailable' || holdings?.nftStatus === 'partial'}<Notice tone="info" title="Some collectibles may be missing" body="We couldn’t load all your collectibles. Some may stay in this wallet." />{/if}
	{#if frozenNfts.length}<Notice tone="info" title="These collectibles can’t be sent" body={frozenNfts.map(n => n.name ?? shortAddress(n.id)).join(', ')} />{/if}
	{#if excluded.length}<Notice tone="info" title="Some assets will stay here" body={excluded.map(t => `${t.name ?? shortAddress(t.mint)}: ${transferRestriction(t)}`).join(' ')} />{/if}
	<p class="flex items-center justify-between px-1 text-[14px]" aria-live="polite"><span class="text-muted-foreground">Estimated approvals</span><span class="font-medium tabular-nums">{!selectedCount ? 0 : approvalQuery.isPending ? 'Calculating…' : approvalQuery.isError ? 'Unavailable' : approvalQuery.data}</span></p>
	<p class="px-1 text-[13px] leading-relaxed text-muted-foreground">The estimate may change. If you stop, completed transfers stay sent. SOL is sent last, after fees and any required fee top-up.</p>
	<OwnerApproval action="send these assets" {accessory} {cluster} active={open} {busy}>
		<Button size="xl" disabled={busy || !holdings || !selectedCount} onclick={sendAll}>{#if busy}<Spinner />{progress}{:else}Send {selectedCount} {selectedCount === 1 ? 'asset' : 'assets'} to owner{/if}</Button>
	</OwnerApproval>
</ResponsiveSheet>
