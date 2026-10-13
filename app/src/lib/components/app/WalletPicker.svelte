<script lang="ts">
	import ListRowSkeleton from './ListRowSkeleton.svelte';
	import EmptyState from './EmptyState.svelte';
	import { onMount } from 'svelte';
	import { platform, type Platform } from '$lib/client/capability';
	import { recentWallet } from '$lib/client/memory';
	import { walletChoices } from '$lib/client/wallet/catalog';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	let {
		options,
		connecting = null,
		onpick,
		onbrowse = () => {},
		browseTarget = null,
		label,
		emptyHint = 'Install a Solana wallet, or open this page in your wallet app.'
	}: {
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
		/** Called when a wallet app's "Open in …" browse link is followed. */
		onbrowse?: () => void;
		/** A page of ours to open inside a wallet app on phones without a detected wallet. */
		browseTarget?: string | null;
		label?: string;
		emptyHint?: string;
	} = $props();

	let device = $state<Platform>('desktop');
	let origin = $state('');
	let recent = $state<string | null>(null);
	onMount(() => {
		device = platform();
		origin = window.location.origin;
		recent = recentWallet();
	});
	const choices = $derived(
		origin ? walletChoices(options, { browseTarget, platform: device, origin, recent }) : []
	);
</script>

{#if !origin}
	<List {label}>
		{#each [0, 1] as i (i)}<ListRowSkeleton avatar="size-9 rounded-[9px]" />{/each}
	</List>
{:else if choices.length === 0}
	<EmptyState title="No wallet found" body={emptyHint} />
{:else}
	<List {label}>
		{#each choices as c (c.key)}
			{#if c.kind === 'detected'}
				<ListRow
					label={c.name}
					detail={connecting === c.connectorId ? 'Connecting…' : c.recent ? 'Recent' : undefined}
					onclick={() => onpick(c.connectorId)}
					busy={connecting === c.connectorId}
					disabled={(!!connecting && connecting !== c.connectorId) || !c.ready}
					chevron
				>
					{#snippet leading()}
						{#if c.icon}<img src={c.icon} alt="" class="size-9 rounded-[9px]" />{:else}<span
								class="grid size-9 place-items-center rounded-[9px] bg-muted"
								><WalletIcon class="size-4" /></span
							>{/if}
					{/snippet}
				</ListRow>
			{:else}
				<ListRow
					label={`Open in ${c.name}`}
					detail={c.recent ? 'Recent' : undefined}
					href={c.href}
					onclick={onbrowse}
					rel="noopener"
					external
				>
					{#snippet leading()}<img src={c.icon} alt="" class="size-9 rounded-[9px]" />{/snippet}
				</ListRow>
			{/if}
		{/each}
	</List>
{/if}
