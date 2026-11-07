import { base64UrlToBytes, bytesToBase64Url } from '#lib/shared/encoding.ts';
import { normalizeMediaUrl } from '#lib/shared/asset-media.ts';

/**
 * Artwork is fetched here and served from our origin. The browser never loads the publisher URL, and Helius
 * `cdn_uri` is not a publisher URL. The HMAC keeps this from being an open proxy.
 */
export const ASSET_IMAGE_PATH = '/asset-image';
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_URLS = 80;
const TIMEOUT_MS = 8_000;
/** Domain-separates these MACs from session cookies signed with the same secret. */
const CONTEXT = 'revibase-asset-image\n';

/**
 * ipfs.io answers server fetches with "blocked". The CID is the image; these gateways serve that CID.
 * The signed link still names the original URL. Filebase is first because Pinata is often slow.
 */
const IPFS_GATEWAYS = ['https://ipfs.filebase.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/'];
/** Pinata answers a fetch with no User-Agent with a 403 HTML page, which is not an image. */
const FETCH_UA = 'Revibase/1.0';

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function macKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (!key) {
		key = crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign', 'verify']
		);
		keyCache.set(secret, key);
	}
	return key;
}

export function sourcesFor(url: string): string[] {
	const prefix = 'https://ipfs.io/ipfs/';
	if (!url.startsWith(prefix)) return [url];
	const path = url.slice(prefix.length);
	return IPFS_GATEWAYS.map((gateway) => gateway + path);
}

export async function assetImagePath(secret: string, url: string): Promise<string> {
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', await macKey(secret), encoder.encode(CONTEXT + url))
	);
	return `${ASSET_IMAGE_PATH}?u=${encodeURIComponent(url)}&s=${bytesToBase64Url(mac)}`;
}

export async function verifyAssetImageUrl(
	secret: string,
	url: string | null,
	mac: string | null
): Promise<boolean> {
	if (!url || !mac || normalizeMediaUrl(url) !== url) return false;
	try {
		return await crypto.subtle.verify(
			'HMAC',
			await macKey(secret),
			base64UrlToBytes(mac),
			encoder.encode(CONTEXT + url)
		);
	} catch {
		return false;
	}
}

export async function assetImagePaths(
	secret: string,
	urls: readonly string[]
): Promise<Record<string, string>> {
	const signed: Record<string, string> = {};
	for (const url of urls.slice(0, MAX_URLS)) {
		if (signed[url] || normalizeMediaUrl(url) !== url) continue;
		signed[url] = await assetImagePath(secret, url);
	}
	return signed;
}

/** The raster type sniffed from the bytes, or `null`; SVG is never served from our origin. */
const ascii = (bytes: Uint8Array, at: number, text: string) =>
	[...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

export function imageType(bytes: Uint8Array): string | null {
	if (bytes.length < 12) return null;
	if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
		return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
	if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
	if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')))
		return 'image/avif';
	return null;
}

export type AssetImage = { bytes: Uint8Array<ArrayBuffer>; type: string };

async function readImage(url: string): Promise<AssetImage | null> {
	const res = await fetch(url, {
		headers: {
			accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
			'user-agent': FETCH_UA
		},
		// A cached 403 from a gateway must not stick for the day and hide a later success.
		cache: 'no-store',
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) return null;
	if (Number(res.headers.get('content-length') ?? 0) > MAX_ASSET_BYTES) return null;
	const bytes = new Uint8Array(await res.arrayBuffer());
	const type = bytes.length <= MAX_ASSET_BYTES ? imageType(bytes) : null;
	return type ? { bytes, type } : null;
}

export async function fetchAssetImage(url: string): Promise<AssetImage | null> {
	if (normalizeMediaUrl(url) !== url) return null;
	const sources = sourcesFor(url);
	return new Promise((resolve) => {
		let pending = sources.length;
		let settled = false;
		for (const source of sources) {
			readImage(source)
				.then((image) => {
					if (image && !settled) {
						settled = true;
						resolve(image);
					}
				})
				.catch(() => {
					/* Try whichever source is still running. */
				})
				.finally(() => {
					pending -= 1;
					if (pending === 0 && !settled) resolve(null);
				});
		}
	});
}
