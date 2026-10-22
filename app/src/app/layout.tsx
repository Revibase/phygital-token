import type { Metadata, Viewport } from 'next';

import { Providers } from '#lib/client/providers';
import { loadBoot } from '#lib/server/boot.ts';

import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: { default: 'Revibase', template: '%s · Revibase' },
	applicationName: 'Revibase',
	appleWebApp: { title: 'Revibase' },
	icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }], apple: '/apple-touch-icon.png' },
	manifest: '/manifest.webmanifest'
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	themeColor: '#f7f4ef',
	colorScheme: 'light'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const boot = await loadBoot();
	return (
		<html lang="en">
			<head>
				<meta name="text-scale" content="scale" />
			</head>
			<body>
				<Providers boot={boot}>{children}</Providers>
			</body>
		</html>
	);
}
