<script lang="ts">
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import QrCode from './QrCode.svelte';
	import CopyField from './CopyField.svelte';
	import { networkLabel } from '$lib/shared/explorer';

	let { open = $bindable(false), address, cluster, description = 'Receive SOL, tokens and collectibles on Solana.' }: { open?: boolean; address: string; cluster?: string; description?: string } = $props();
</script>

<ResponsiveSheet bind:open title="Receive" {description}>
	<div class="space-y-5">
		{#if cluster}<p class="text-center text-[13px] font-medium text-muted-foreground">Solana{networkLabel(cluster) ? ` · ${networkLabel(cluster)}` : ''}</p>{/if}
		<QrCode value={`solana:${address}`} accessibleLabel="Accessory wallet address QR code" label="Scan with any Solana wallet." />
		<CopyField value={address} label="Copy address" mono />
	</div>
</ResponsiveSheet>
