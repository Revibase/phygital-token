<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import PairQr from './PairQr.svelte';
	let { open = $bindable(false), href, label }: { open?: boolean; href: string; label: string } = $props();
	const desktop = new MediaQuery('min-width: 768px', false);
	async function copy() {
		try { await navigator.clipboard.writeText(href); toast.success('Payment link copied'); }
		catch { toast.error('Couldn’t copy payment link. Try again.'); }
	}
	const action = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>
<ResponsiveSheet bind:open title={label} description="Solana Pay">
	<div class="space-y-5">
		{#if !desktop.current}<a {href} class="{action} bg-primary text-primary-foreground"><Wallet class="size-4" />Open in wallet</a>{/if}
		<PairQr value={href} accessibleLabel="Solana Pay request QR code" label="Scan with your wallet to continue." />
		<div class="space-y-2">
			{#if desktop.current}<a {href} class="{action} bg-muted"><Wallet class="size-4" />Open in wallet</a>{/if}
			<button type="button" onclick={copy} class="{action} bg-muted"><Copy class="size-4" />Copy payment link</button>
		</div>
		<p class="text-center text-xs leading-relaxed text-muted-foreground">Wallet didn’t open? Use a wallet that supports Solana Pay. Review and approve the request there.</p>
		<a href="https://docs.solanapay.com/" target="_blank" rel="noopener noreferrer" class="block min-h-11 py-3 text-center text-sm font-medium text-primary underline underline-offset-4">Get a wallet</a>
	</div>
</ResponsiveSheet>
