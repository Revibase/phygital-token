<script lang="ts">
	import { onMount } from 'svelte';
	import { recentWallet } from '#lib/client/memory.ts';
	import type { WalletOption } from '#lib/client/wallet/wallet.svelte.ts';
	import EmptyState from './EmptyState.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	let {
		options,
		connecting = null,
		onpick,
		label,
		emptyHint = 'Open this page in a wallet app that supports Solana.'
	}: {
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
		label?: string;
		emptyHint?: string;
	} = $props();

	let recent = $state<string | null>(null);
	onMount(() => (recent = recentWallet()));
	const choices = $derived(
		[...options].sort((a, b) => Number(b.name === recent) - Number(a.name === recent))
	);
</script>

{#if choices.length === 0}
	<EmptyState title="No wallet found" body={emptyHint} />
{:else}
	<List {label}>
		{#each choices as wallet (wallet.id)}
			<ListRow
				label={wallet.name}
				detail={connecting === wallet.id
					? 'Connecting…'
					: wallet.name === recent
						? 'Recent'
						: undefined}
				onclick={() => onpick(wallet.id)}
				busy={connecting === wallet.id}
				disabled={(!!connecting && connecting !== wallet.id) || !wallet.ready}
				chevron
			>
				{#snippet leading()}
					{#if wallet.icon}<img src={wallet.icon} alt="" class="size-9 rounded-[9px]" />{:else}<span
							class="grid size-9 place-items-center rounded-[9px] bg-muted"
							><WalletIcon class="size-4" /></span
						>{/if}
				{/snippet}
			</ListRow>
		{/each}
	</List>
{/if}
