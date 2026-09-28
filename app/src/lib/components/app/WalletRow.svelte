<script lang="ts">
	import ListRow from './ListRow.svelte';
	import WalletAvatar from './WalletAvatar.svelte';
	import CopyButton from './CopyButton.svelte';
	import { shortAddress } from '$lib/shared/encoding';

	/** A wallet inside a List: avatar, label, short address, copy. */
	let { address, label, icon = null }: { address: string; label: string; icon?: string | null } = $props();
</script>

<ListRow {label} detail={shortAddress(address)}>
	{#snippet leading()}<WalletAvatar {address} {icon} />{/snippet}
	{#snippet trailing()}<CopyButton value={address} label="Copy wallet address" />{/snippet}
</ListRow>
