<script lang="ts">
	import { KNOWN_WALLETS, type KnownWallet } from '$lib/client/wallet/catalog';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';

	let {
		hrefFor,
		label,
		open = $bindable(false)
	}: { hrefFor: ((wallet: KnownWallet) => string) | null; label: string; open?: boolean } = $props();
</script>

<ResponsiveSheet bind:open title={label} description="Opens in your wallet app, so it can connect.">
	{#if hrefFor}
		<List>
			{#each KNOWN_WALLETS as w (w.id)}
				<ListRow label={`Open in ${w.name}`} href={hrefFor(w)} rel="noopener noreferrer" external>
					{#snippet leading()}<img src={w.icon} alt="" class="size-9 rounded-[9px]" />{/snippet}
				</ListRow>
			{/each}
		</List>
	{/if}
</ResponsiveSheet>
