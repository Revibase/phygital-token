<script lang="ts">
	import { onMount } from 'svelte';
	import { platform, type Platform } from '$lib/client/capability';
	import { walletChoices } from '$lib/client/wallet/catalog';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	/**
	 * Wallets detected by `@solana/connector`, then — on phones — "Open in …"
	 * rows for known wallets that weren't detected (reopens `browseTarget`
	 * inside that wallet's browser). One list, one visual weight per row.
	 */
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
	onMount(() => {
		device = platform();
		origin = window.location.origin;
	});
	const choices = $derived(origin ? walletChoices(options, { browseTarget, platform: device, origin }) : []);
</script>

{#if origin && choices.length === 0}
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
					detail={connecting === c.connectorId ? 'Connecting…' : undefined}
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
				<ListRow label={`Open in ${c.name}`} href={c.href} rel="noopener" external>
					{#snippet leading()}<span class="grid size-9 place-items-center rounded-[9px] bg-muted"><WalletIcon class="size-4 text-muted-foreground" /></span>{/snippet}
				</ListRow>
			{/if}
		{/each}
	</List>
{/if}
