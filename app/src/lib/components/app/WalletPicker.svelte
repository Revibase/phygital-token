<script lang="ts">
	import ListRowSkeleton from './ListRowSkeleton.svelte';
	import EmptyState from './EmptyState.svelte';
	import { onMount } from 'svelte';
	import { recentWallet } from '$lib/client/memory';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	let {
		options,
		connecting = null,
		onpick,
		label,
		emptyHint = 'Install a Solana wallet that works in this browser, then try again.'
	}: {
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
		label?: string;
		emptyHint?: string;
	} = $props();

	let mounted = $state(false);
	let recent = $state<string | null>(null);
	onMount(() => {
		recent = recentWallet();
		mounted = true;
	});
	const choices = $derived(
		[...options].sort((a, b) => Number(b.name === recent) - Number(a.name === recent))
	);
</script>

{#if !mounted}
	<List {label}>
		{#each [0, 1] as i (i)}<ListRowSkeleton avatar="size-9 rounded-[9px]" />{/each}
	</List>
{:else if choices.length === 0}
	<EmptyState title="No wallet found" body={emptyHint} />
{:else}
	<List {label}>
		{#each choices as c (c.id)}
			<ListRow
				label={c.name}
				detail={connecting === c.id ? 'Connecting…' : c.name === recent ? 'Recent' : c.hint}
				onclick={() => onpick(c.id)}
				busy={connecting === c.id}
				disabled={(!!connecting && connecting !== c.id) || !c.ready}
				chevron
			>
				{#snippet leading()}
					{#if c.icon}<img src={c.icon} alt="" class="size-9 rounded-[9px]" />{:else}<span
							class="grid size-9 place-items-center rounded-[9px] bg-muted"
							><WalletIcon class="size-4" /></span
						>{/if}
				{/snippet}
			</ListRow>
		{/each}
	</List>
{/if}
