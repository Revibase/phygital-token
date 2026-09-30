import type { Shortcut } from '$lib/shared/shortcuts';

/**
 * Embedded (`immerse`) shortcuts. The frame never gets `publickey-credentials-get`: a tap inside it could be a
 * transfer tap for an unlocked card, under a page that says "Genuine". Apps sign in with the session proof.
 */

const TIMEOUT_MS = 3_000;
const CACHE_TTL_S = 600;

/** No `allow-top-navigation`: the app can't navigate our page. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
export const FRAME_ALLOW = 'fullscreen; clipboard-write';

function sourceAllows(source: string, embedder: URL): boolean {
	const s = source.toLowerCase();
	if (s === '*') return true;
	if (s === 'https:') return embedder.protocol === 'https:';
	if (s.startsWith("'")) return false; // 'none', and 'self' is the project's origin, never ours
	const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^:/]+)(?::(\d+|\*))?(?:\/.*)?$/.exec(s);
	if (!m) return false;
	const [, scheme, wildcard, host, port] = m;
	if (scheme && `${scheme}:` !== embedder.protocol && !(scheme === 'http' && embedder.protocol === 'https:')) return false;
	const hostOk = host === '*' || (wildcard ? embedder.hostname.endsWith(`.${host}`) : embedder.hostname === host);
	const defaultPort = embedder.protocol === 'https:' ? '443' : '80';
	const portOk = port === '*' || (port ?? defaultPort) === (embedder.port || defaultPort);
	return hostOk && portOk;
}

/**
 * As a browser decides: `frame-ancestors` wins when present (every policy must allow us), otherwise any
 * `X-Frame-Options` refuses (ALLOW-FROM is obsolete).
 */
export function allowsFraming(headers: Headers, embedder: string): boolean {
	const origin = new URL(embedder);
	const policies = (headers.get('content-security-policy') ?? '').split(',');
	const ancestors = policies
		.map((p) => p.split(';').map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d)))
		.filter((d): d is string => !!d);
	if (ancestors.length > 0) {
		return ancestors.every((d) => d.split(/\s+/).slice(1).some((src) => sourceAllows(src, origin)));
	}
	return !headers.get('x-frame-options');
}

/**
 * Must stay on its own origin (a cross-origin redirect would load blank under our frame-src). Never call it
 * with a session proof in the URL: the check would spend the proof's single use.
 */
export async function isFramable(href: string, embedder: string): Promise<boolean> {
	try {
		const target = new URL(href);
		if (target.protocol !== 'https:') return false;
		const res = await fetch(target.href, {
			headers: { accept: 'text/html' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true }
		} as RequestInit);
		await res.body?.cancel();
		if (!res.ok || (res.url && new URL(res.url).origin !== target.origin)) return false;
		return allowsFraming(res.headers, embedder);
	} catch {
		return false;
	}
}

export async function withFramingCheck(shortcuts: Shortcut[], embedder: string): Promise<Shortcut[]> {
	return Promise.all(
		shortcuts.map(async (s) => (s.immerse && !(await isFramable(s.href, embedder)) ? { ...s, immerse: false } : s))
	);
}
