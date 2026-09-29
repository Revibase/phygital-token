<script lang="ts">
	import QRCode from 'qrcode';

	let { value, label = 'Point your phone’s camera at this code.' }: { value: string; label?: string } = $props();
	let svg = $state('');
	$effect(() => {
		QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0e1a1a', light: '#ffffff' } })
			.then((s) => (svg = s))
			.catch(() => (svg = ''));
	});
</script>

<figure class="mx-auto w-full max-w-60 space-y-3">
	<!-- Fixed square box: the QR fades in without shifting the layout. -->
	<div class="aspect-square rounded-[20px] bg-white p-5 shadow-[0_0_0_1px_rgb(14_26_26/0.06),0_12px_32px_-18px_rgb(14_26_26/0.35)]" role="img" aria-label="Pairing code to scan with your phone">
		{#if svg}
			<!-- Safe to inject: generated locally by `qrcode` from our own URL. -->
			<div class="animate-rise size-full [&_svg]:size-full">{@html svg}</div>
		{/if}
	</div>
	<figcaption class="text-center text-[13px] text-muted-foreground">{label}</figcaption>
</figure>
