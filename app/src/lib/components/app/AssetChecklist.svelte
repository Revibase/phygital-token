<script lang="ts" module>
	import { transferRestriction, type WalletHoldings } from '$lib/shared/wallet-holdings';

	/** What a send-all moves: every sendable asset not unchecked (keyed 'sol', token account or NFT id). */
	export function selectedAssets(holdings: WalletHoldings, unchecked: ReadonlySet<string>) {
		return {
			holdings: {
				...holdings,
				tokens: holdings.tokens.filter(
					(t) => !transferRestriction(t) && !unchecked.has(t.tokenAccount)
				),
				nfts: (holdings.nfts ?? []).filter((n) => !n.frozen && !unchecked.has(n.id))
			},
			sendSol: !!holdings.lamports && !unchecked.has('sol')
		};
	}
</script>

<script lang="ts">
	import { SOL_INFO } from '$lib/shared/policy-explain';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import TokenIcon from './TokenIcon.svelte';
	import Notice from './Notice.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { isCollectible } from '$lib/shared/wallet-holdings';
	import { formatCompactTokenAmount, SOL_DECIMALS } from '$lib/shared/amount';
	import { shortAddress } from '$lib/shared/encoding';

	/** The assets a send-all can move, each with a checkbox; what can't be sent is listed below. */
	let {
		holdings,
		unchecked = $bindable(new Set()),
		busy = false
	}: {
		holdings: WalletHoldings | undefined;
		unchecked?: Set<string>;
		busy?: boolean;
	} = $props();

	const sendable = $derived(holdings?.tokens.filter((t) => !transferRestriction(t)) ?? []);
	const excluded = $derived(holdings?.tokens.filter((t) => transferRestriction(t)) ?? []);
	const nfts = $derived(holdings?.nfts?.filter((n) => !n.frozen) ?? []);
	const frozenNfts = $derived(holdings?.nfts?.filter((n) => n.frozen) ?? []);

	function toggle(id: string) {
		if (busy) return;
		const next = new Set(unchecked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		unchecked = next;
	}
</script>

<List label="Assets to send">
	{#if holdings?.lamports}
		<ListRow
			label="Solana"
			value={`${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`}
			selectable
		>
			{#snippet leading()}<span class="flex items-center gap-1"
					><Checkbox
						class="-ml-2"
						checked={!unchecked.has('sol')}
						disabled={busy}
						onCheckedChange={() => toggle('sol')}
					/><TokenIcon src={SOL_INFO.icon} label="SOL" /></span
				>{/snippet}
		</ListRow>
	{/if}
	{#each sendable as token (token.tokenAccount)}
		{@const name = token.name ?? token.symbol ?? shortAddress(token.mint)}
		<ListRow
			label={name}
			value={`${isCollectible(token) ? '1' : formatCompactTokenAmount(token.amount, token.decimals)}${token.symbol ? ` ${token.symbol}` : isCollectible(token) ? ' NFT' : ''}`}
			selectable
		>
			{#snippet leading()}<span class="flex items-center gap-1"
					><Checkbox
						class="-ml-2"
						checked={!unchecked.has(token.tokenAccount)}
						disabled={busy}
						onCheckedChange={() => toggle(token.tokenAccount)}
					/><TokenIcon src={token.icon} label={name} /></span
				>{/snippet}
		</ListRow>
	{/each}
	{#each nfts as nft (nft.id)}
		{@const name = nft.name ?? shortAddress(nft.id)}
		<ListRow label={name} value={`1 ${nft.symbol ?? 'NFT'}`} selectable>
			{#snippet leading()}<span class="flex items-center gap-1"
					><Checkbox
						class="-ml-2"
						checked={!unchecked.has(nft.id)}
						disabled={busy}
						onCheckedChange={() => toggle(nft.id)}
					/><TokenIcon src={nft.icon} label={name} /></span
				>{/snippet}
		</ListRow>
	{/each}
</List>
{#if holdings?.nftStatus === 'unavailable' || holdings?.nftStatus === 'partial'}<Notice
		tone="info"
		title="Some collectibles may be missing"
		body="We couldn’t load all your collectibles. Some may stay in this wallet."
	/>{/if}
{#if frozenNfts.length}<Notice
		tone="info"
		title="These collectibles can’t be sent"
		body={frozenNfts.map((n) => n.name ?? shortAddress(n.id)).join(', ')}
	/>{/if}
{#if excluded.length}<Notice
		tone="info"
		title="Some assets will stay here"
		body={excluded
			.map((t) => `${t.name ?? shortAddress(t.mint)}: ${transferRestriction(t)}`)
			.join(' ')}
	/>{/if}
