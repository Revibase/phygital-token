<script lang="ts">
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import CopyButton from './CopyButton.svelte';
	import ExplorerLink from './ExplorerLink.svelte';
	import { shortAddress } from '$lib/shared/encoding';

	let { address, label, icon = null, cluster = null }: { address: string; label: string; icon?: string | null; cluster?: string | null } = $props();
</script>

<ListRow {label} detail={shortAddress(address)}>
	{#snippet leading()}<WalletAvatar {address} {icon} />{/snippet}
	{#snippet trailing()}
		<span class="flex items-center">
			{#if cluster}<ExplorerLink value={address} {cluster} label="View wallet on Solana Explorer" />{/if}
			<CopyButton value={address} label="Copy wallet address" />
		</span>
	{/snippet}
</ListRow>
