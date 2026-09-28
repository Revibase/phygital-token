<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { platform, type Platform } from '$lib/client/capability';
	import { walletChoices } from '$lib/client/wallet/catalog';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	/**
	 * Wallets come from `@solana/connector` auto-detection. On phones, known
	 * wallets that weren't detected get an "Open in …" deep link that reopens
	 * `browseTarget` inside that wallet's in-app browser.
	 */
	let {
		options,
		connecting = null,
		onpick,
		browseTarget = null,
		emptyHint = 'Install a Solana wallet extension, or open this page inside your wallet app’s browser.'
	}: {
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
		browseTarget?: string | null;
		emptyHint?: string;
	} = $props();

	let device = $state<Platform>('desktop');
	let origin = $state('');
	onMount(() => {
		device = platform();
		origin = window.location.origin;
	});

	const choices = $derived(origin ? walletChoices(options, { browseTarget, platform: device, origin }) : []);
	const detected = $derived(choices.filter((c) => c.kind === 'detected'));
	const browse = $derived(choices.filter((c) => c.kind === 'browse'));
</script>

{#if choices.length === 0}
	<p class="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
		<span class="block font-medium text-foreground">No wallet found here</span>
		{emptyHint}
	</p>
{:else}
	<div class="space-y-4">
		{#if detected.length > 0}
			<div class="grid gap-2">
				{#each detected as w (w.key)}
					{#if w.kind === 'detected'}
						<Button
							variant="outline"
							size="lg"
							class="h-14 justify-start gap-3 rounded-xl px-4 text-base"
							disabled={!!connecting || !w.ready}
							onclick={() => onpick(w.connectorId)}
						>
							{#if w.icon}<img src={w.icon} alt="" class="size-7 rounded-lg" />{:else}<WalletIcon class="size-5" />{/if}
							<span class="flex-1 text-left">{w.name}</span>
							{#if connecting === w.connectorId}<Spinner />{/if}
						</Button>
					{/if}
				{/each}
			</div>
		{/if}
		{#if browse.length > 0}
			<div class="space-y-2">
				{#if detected.length > 0}<p class="text-sm text-muted-foreground">Or open in a wallet app</p>{/if}
				<div class="grid gap-2">
					{#each browse as w (w.key)}
						{#if w.kind === 'browse'}
							<Button
								href={w.href}
								rel="noopener"
								variant={detected.length > 0 ? 'outline' : 'default'}
								size="lg"
								class="h-14 justify-between rounded-xl px-4 text-base"
							>
								<span class="flex items-center gap-3"><WalletIcon class="size-5" /> Open in {w.name}</span>
								<ExternalLinkIcon />
							</Button>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
