<script lang="ts">
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import QrCode from './QrCode.svelte';
	import CopyField from './CopyField.svelte';
	import { networkLabel } from '#lib/shared/explorer.ts';

	let {
		open = $bindable(false),
		address,
		cluster,
		description = 'Only send SOL and Solana tokens to this address.'
	}: { open?: boolean; address: string; cluster?: string; description?: string } = $props();
	// Only a test network needs saying.
	const network = $derived(cluster ? networkLabel(cluster) : null);
</script>

<ResponsiveSheet bind:open title="Receive" {description}>
	<div class="space-y-5">
		{#if network}<p class="text-center text-[13px] font-medium text-muted-foreground">
				On {network}
			</p>{/if}
		<QrCode
			value={`solana:${address}`}
			accessibleLabel="Wallet address QR code"
			label="Scan with any Solana wallet."
		/>
		<CopyField value={address} label="Copy address" mono />
	</div>
</ResponsiveSheet>
