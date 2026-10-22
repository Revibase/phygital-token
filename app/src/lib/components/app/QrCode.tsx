'use client';

import { useEffect, useState } from 'react';

export function QrCode({
	value,
	label = 'Point your phone’s camera at this code.',
	accessibleLabel = 'QR code'
}: {
	value: string;
	label?: string;
	accessibleLabel?: string;
}) {
	const [svg, setSvg] = useState('');
	useEffect(() => {
		let active = true;
		setSvg('');
		void import('qrcode')
			.then(({ default: QRCode }) =>
				QRCode.toString(value, {
					type: 'svg',
					margin: 0,
					errorCorrectionLevel: 'M',
					color: { dark: '#0e1a1a', light: '#ffffff' }
				})
			)
			.then((result) => {
				if (active) setSvg(result);
			})
			.catch(() => {
				if (active) setSvg('');
			});
		return () => {
			active = false;
		};
	}, [value]);

	return (
		<figure className="mx-auto w-full max-w-60 space-y-3">
			<div
				className="aspect-square rounded-[20px] bg-white p-5 shadow-[0_0_0_1px_rgb(14_26_26/0.06),0_12px_32px_-18px_rgb(14_26_26/0.35)]"
				role="img"
				aria-label={accessibleLabel}
			>
				{svg ? (
					<div className="animate-rise size-full [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
				) : null}
			</div>
			<figcaption className="text-center text-[13px] text-muted-foreground">{label}</figcaption>
		</figure>
	);
}
