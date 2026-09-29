<script lang="ts">
	import { onMount } from 'svelte';
	import { platform, type Platform } from '$lib/client/capability';
	import { recentWallet } from '$lib/client/memory';
	import { walletChoices } from '$lib/client/wallet/catalog';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	let {
		options,
		connecting = null,
		onpick,
		browseTarget = null,
		label,
		emptyHint = 'Install a Solana wallet, or open this page in your wallet app.'
	}: {
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
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
	const choices = $derived(origin ? walletChoices(options, { browseTarget, platform: device, origin, recent }) : []);
</script>

{#if !origin}
	<!-- Wallets are detected after hydration; hold the space so the page doesn't pop. -->
	<List {label}>
		{#each [0, 1] as i (i)}
			<li class="flex min-h-14 items-center gap-3 px-4 py-2.5" aria-hidden="true">
				<Skeleton class="size-9 rounded-[9px]" /><Skeleton class="h-3.5 w-28" />
			</li>
		{/each}
	</List>
{:else if choices.length === 0}
	<div class="rounded-[14px] bg-muted px-4 py-5 text-center">
		<p class="text-[15px] font-medium">No wallet found</p>
		<p class="mt-0.5 text-[14px] text-muted-foreground">{emptyHint}</p>
	</div>
{:else if choices.length > 0}
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
						{#if c.icon}<img src={c.icon} alt="" class="size-9 rounded-[9px]" />{:else}<span class="grid size-9 place-items-center rounded-[9px] bg-muted"><WalletIcon class="size-4" /></span>{/if}
					{/snippet}
				</ListRow>
			{:else}
				<ListRow label={`Open in ${c.name}`} detail={c.recent ? 'Recent' : undefined} href={c.href} rel="noopener" external>
					{#snippet leading()}<img src={c.icon} alt="" class="size-9 rounded-[9px]" />{/snippet}
				</ListRow>
			{/if}
		{/each}
	</List>
{/if}
