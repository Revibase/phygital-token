<script lang="ts">
	import QRCode from 'qrcode';

	let { value, label = 'Scan with your phone’s camera' }: { value: string; label?: string } = $props();
	let svg = $state('');
	$effect(() => {
		QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
			.then((s) => (svg = s))
			.catch(() => (svg = ''));
	});
</script>

<figure class="mx-auto w-full max-w-64 space-y-3">
	<div class="aspect-square overflow-hidden rounded-2xl bg-white p-3 shadow-lg [&_svg]:size-full" role="img" aria-label="Pairing QR code">
		<!-- eslint-disable-next-line svelte/no-at-html-tags — generated locally by `qrcode` from our own URL -->
		{@html svg}
	</div>
	<figcaption class="text-center text-sm text-muted-foreground">{label}</figcaption>
</figure>
