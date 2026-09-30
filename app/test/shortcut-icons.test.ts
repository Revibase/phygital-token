import { afterEach, describe, expect, it } from 'vitest';

import { ICON_PATH, MAX_ICON_BYTES, fetchIconImage, iconProxyPath, imageType, verifyIconUrl, withIconProxy } from '$lib/server/accessory/shortcut-icons';
import type { Shortcut } from '$lib/shared/shortcuts';

const SECRET = 'x'.repeat(32);
const URL_ = 'https://cdn.game.xyz/icons/play.png';

const bytes = (...parts: Array<number[] | string>) =>
	new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(new Array(16).fill(0)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const GIF = bytes('GIF89a');
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBP');
const AVIF = bytes([0, 0, 0, 0x20], 'ftypavif');
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = bytes('<!doctype html><script>alert(1)</script>');

describe('imageType', () => {
	it('recognises raster images by signature, whatever they claim to be', () => {
		expect([PNG, JPEG, GIF, WEBP, AVIF].map(imageType)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
	});

	it('refuses SVG, HTML and anything else', () => {
		expect(imageType(SVG)).toBeNull();
		expect(imageType(HTML)).toBeNull();
		expect(imageType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
		expect(imageType(new Uint8Array([0x89, 0x50]))).toBeNull();
	});
});

describe('signed proxy links', () => {
	it('verifies only the URL it was minted for', async () => {
		const path = await iconProxyPath(SECRET, URL_);
		const link = new URL(path, 'https://portal.revibase.com');
		expect(link.pathname).toBe(ICON_PATH);
		const [u, s] = [link.searchParams.get('u'), link.searchParams.get('s')];
		expect(u).toBe(URL_);
		expect(await verifyIconUrl(SECRET, u, s)).toBe(true);
		expect(await verifyIconUrl(SECRET, 'https://evil.test/x.png', s)).toBe(false);
		expect(await verifyIconUrl('y'.repeat(32), u, s)).toBe(false);
		expect(await verifyIconUrl(SECRET, u, 'AAAA')).toBe(false);
		expect(await verifyIconUrl(SECRET, u, null)).toBe(false);
	});

	it('rewrites only shortcuts that have an image', async () => {
		const base = { label: 'Play', href: 'https://game.xyz', icon: 'generic-link', immerse: false, proof: false, external: false, platform: 'all' } as const;
		const [withImage, glyph] = await withIconProxy([{ ...base, image: URL_ }, { ...base, image: null }] satisfies Shortcut[], SECRET);
		expect(withImage.image).toBe(await iconProxyPath(SECRET, URL_));
		expect(glyph.image).toBeNull();
	});
});

describe('fetchIconImage', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	const serve = (body: Uint8Array, headers: Record<string, string> = {}, status = 200) => {
		globalThis.fetch = (async () => new Response(body.slice(), { status, headers })) as typeof fetch;
	};

	it('returns supported images with the type read from their bytes', async () => {
		serve(WEBP, { 'content-type': 'image/png' });
		expect(await fetchIconImage(URL_)).toMatchObject({ type: 'image/webp' });
		serve(JPEG);
		expect((await fetchIconImage(URL_))?.type).toBe('image/jpeg');
	});

	it('refuses SVG even when labelled as an image, oversized files and failures', async () => {
		serve(SVG, { 'content-type': 'image/svg+xml' });
		expect(await fetchIconImage(URL_)).toBeNull();
		serve(new Uint8Array(MAX_ICON_BYTES + 1).fill(0).map((_, i) => PNG[i] ?? 0));
		expect(await fetchIconImage(URL_)).toBeNull();
		serve(PNG, { 'content-length': String(MAX_ICON_BYTES + 1) });
		expect(await fetchIconImage(URL_)).toBeNull();
		serve(PNG, {}, 404);
		expect(await fetchIconImage(URL_)).toBeNull();
		globalThis.fetch = (async () => {
			throw new Error('timeout');
		}) as typeof fetch;
		expect(await fetchIconImage(URL_)).toBeNull();
	});
});
