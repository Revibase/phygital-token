/**
 * Phone, computer, or a Mac user agent that may really be an iPad (iPadOS
 * Safari reports itself as a Mac; only the client can tell by touch points).
 */
export type DeviceClass = 'mobile' | 'desktop' | 'mac';

export function deviceClass(userAgent: string | null): DeviceClass {
	const ua = userAgent ?? '';
	if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return 'mobile';
	return /Macintosh/.test(ua) ? 'mac' : 'desktop';
}

/** What a desktop visitor should open on their phone: never single-use tap parameters. */
export function phoneUrl(url: URL): string {
	if (url.pathname === '/permissions') return url.href;
	const out = new URL(url.pathname, url.origin);
	const link = url.searchParams.get('link');
	if (link) out.searchParams.set('link', link);
	return out.href;
}
