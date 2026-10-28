/**
 * What a `/ul/browse/<url>?ref=<origin>` link opens: the Phantom, Solflare and Backpack browse deeplink.
 * `ref` is whatever the link's author wrote, so the page is labelled by its own hostname instead.
 */
export type BrowseTarget =
	{ ok: true; href: string; hostname: string } | { ok: false; reason: 'missing' | 'invalid' };

export function readBrowseLink(segments: readonly string[] | undefined): BrowseTarget {
	if (!segments?.length) return { ok: false, reason: 'missing' };
	let raw = segments.join('/');
	if (!/^https?:/i.test(raw)) {
		try {
			raw = decodeURIComponent(raw);
		} catch {
			return { ok: false, reason: 'invalid' };
		}
	}
	const url = parseHttpUrl(raw.replace(/^(https?):\/*/i, '$1://'));
	if (!url) return { ok: false, reason: 'invalid' };
	return { ok: true, href: url.href, hostname: url.hostname.replace(/^www\./, '') };
}

function parseHttpUrl(raw: unknown): URL | null {
	if (typeof raw !== 'string' || raw.length < 1 || raw.length > 4096) return null;
	try {
		const url = new URL(raw);
		if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
			return null;
		return url;
	} catch {
		return null;
	}
}
