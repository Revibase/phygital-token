<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';

	let {
		options,
		connecting = null,
		onpick,
		emptyHint = 'Install a Solana wallet, or open this page inside your wallet app’s browser.'
	}: { options: WalletOption[]; connecting?: string | null; onpick: (id: string) => void; emptyHint?: string } = $props();
</script>

{#if options.length === 0}
	<p class="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
		<span class="block font-medium text-foreground">No wallet found here</span>
		{emptyHint}
	</p>
{:else}
	<div class="grid gap-2">
		{#each options as w (w.id)}
			<Button
				variant="outline"
				size="lg"
				class="h-14 justify-start gap-3 rounded-xl px-4 text-base"
				disabled={!!connecting || !w.ready}
				onclick={() => onpick(w.id)}
			>
				{#if w.icon}<img src={w.icon} alt="" class="size-7 rounded-lg" />{/if}
				<span class="flex-1 text-left">{w.name}</span>
				{#if connecting === w.id}<Spinner />{/if}
			</Button>
		{/each}
	</div>
{/if}
