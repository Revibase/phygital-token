import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';
import type { Shortcut } from '$lib/shared/shortcuts';

/**
 * Project icons are proxied so the project never sees who's looking. The HMAC keeps this from being an open
 * proxy. Only raster images are served, detected from their bytes: an SVG would be a document on our origin.
 */
export const ICON_PATH = '/shortcut-icon';
export const MAX_ICON_BYTES = 128 * 1024;
const TIMEOUT_MS = 3_000;
const CACHE_TTL_S = 24 * 60 * 60;
/** Domain-separates these MACs from the session cookies signed with the same secret. */
const CONTEXT = 'revibase-shortcut-icon\n';

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function macKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (!key) {
		key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
		keyCache.set(secret, key);
	}
	return key;
}

export async function iconProxyPath(secret: string, url: string): Promise<string> {
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(secret), encoder.encode(CONTEXT + url)));
	return `${ICON_PATH}?u=${encodeURIComponent(url)}&s=${bytesToBase64Url(mac)}`;
}

/** Constant-time, via `crypto.subtle.verify`. */
export async function verifyIconUrl(secret: string, url: string | null, mac: string | null): Promise<boolean> {
	if (!url || !mac) return false;
	try {
		return await crypto.subtle.verify('HMAC', await macKey(secret), base64UrlToBytes(mac), encoder.encode(CONTEXT + url));
	} catch {
		return false;
	}
}

const ascii = (bytes: Uint8Array, at: number, text: string) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

export function imageType(bytes: Uint8Array): string | null {
	if (bytes.length < 12) return null;
	if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
	if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
	if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis'))) return 'image/avif';
	return null;
}

export type IconImage = { bytes: Uint8Array<ArrayBuffer>; type: string };

export async function fetchIconImage(url: string): Promise<IconImage | null> {
	try {
		const res = await fetch(url, {
			headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true }
		} as RequestInit);
		if (!res.ok) return null;
		if (Number(res.headers.get('content-length') ?? 0) > MAX_ICON_BYTES) return null;
		const bytes = new Uint8Array(await res.arrayBuffer());
		const type = bytes.length <= MAX_ICON_BYTES ? imageType(bytes) : null;
		return type ? { bytes, type } : null;
	} catch {
		return null;
	}
}

export async function withIconProxy(shortcuts: Shortcut[], secret: string): Promise<Shortcut[]> {
	return Promise.all(shortcuts.map(async (s) => (s.image ? { ...s, image: await iconProxyPath(secret, s.image) } : s)));
}
