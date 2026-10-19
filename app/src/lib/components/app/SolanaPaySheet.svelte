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
			label="Or scan with your wallet."
		/>
		<Button onclick={copy} variant="secondary" size="xl"
			><Copy class="size-4" />Copy payment link</Button
		>
		<p class="text-center text-[13px] leading-relaxed text-muted-foreground">
			Wallet didn’t open? Use one that supports
			<a
				href="https://docs.solanapay.com/"
				target="_blank"
				rel="noopener noreferrer"
				class="font-medium text-primary underline underline-offset-4">Solana Pay</a
			>.
		</p>
	</div>
</ResponsiveSheet>
