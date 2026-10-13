<script lang="ts">
	import QrCode from './QrCode.svelte';
	import CopyField from './CopyField.svelte';
	import PageHeader from './PageHeader.svelte';
	import PageShell from './PageShell.svelte';

	let { href }: { href: string } = $props();
</script>

<svelte:head><title>Open on your phone · Revibase</title></svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 pt-4 pb-10 text-center">
		<PageHeader
			align="center"
			title="Open on your phone"
			body="Revibase works on your phone, where you tap your accessory and approve in your wallet."
		/>
		<QrCode
			value={href}
			accessibleLabel="QR code to open this page on your phone"
			label="Scan with your phone’s camera."
		/>
		<CopyField value={href} label="Copy link" class="w-full max-w-sm" />
	</section>
</PageShell>
