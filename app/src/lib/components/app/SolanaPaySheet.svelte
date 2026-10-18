<script lang="ts">
	import { copyText } from '#lib/client/clipboard.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Copy from '@lucide/svelte/icons/copy';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import QrCode from './QrCode.svelte';
	let {
		open = $bindable(false),
		href,
		label
	}: { open?: boolean; href: string; label: string } = $props();
	function copy() {
		return copyText(href, 'Payment link copied', 'Couldn’t copy payment link. Try again.');
	}
</script>

<ResponsiveSheet bind:open title={label} description="Solana Pay">
	<div class="space-y-5">
		<Button {href} size="xl"><Wallet class="size-4" />Open in wallet</Button>
		<QrCode
			value={href}
			accessibleLabel="Solana Pay request QR code"
			label="Scan with your wallet to continue."
		/>
		<div class="space-y-2">
			<Button onclick={copy} variant="secondary" size="xl"
				><Copy class="size-4" />Copy payment link</Button
			>
		</div>
		<p class="text-center text-xs leading-relaxed text-muted-foreground">
			Wallet didn’t open? Use a wallet that supports Solana Pay. Review and approve the request
			there.
		</p>
		<a
			href="https://docs.solanapay.com/"
			target="_blank"
			rel="noopener noreferrer"
			class="block min-h-11 py-3 text-center text-sm font-medium text-primary underline underline-offset-4"
			>Get a wallet</a
		>
	</div>
</ResponsiveSheet>
