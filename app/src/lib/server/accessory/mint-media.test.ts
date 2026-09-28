import { describe, expect, it } from 'vitest';

import { createTestD1, MIGRATIONS } from '../testing/d1-sqlite';
import { mediaFromAsset, normalizeMediaUrl, resolveMintMedia } from './mint-media';

describe('mediaFromAsset (Helius getAsset)', () => {
	it('prefers the Helius CDN image, then links.image, then the raw file uri', () => {
		expect(
			mediaFromAsset({
				content: {
					metadata: { name: 'Revibase #12' },
					links: { image: 'https://arweave.net/raw.png' },
					files: [{ uri: 'https://arweave.net/raw.png', cdn_uri: 'https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/raw.png', mime: 'image/png' }]
				}
			})
		).toEqual({ image: 'https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/raw.png', name: 'Revibase #12' });
		expect(mediaFromAsset({ content: { links: { image: 'ipfs://bafy/1.png' } } }).image).toBe('https://ipfs.io/ipfs/bafy/1.png');
		expect(mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.webp', mime: 'image/webp' }] } }).image).toBe('https://x.test/a.webp');
	});

	it('ignores non-image files and missing content', () => {
		expect(mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.mp4', mime: 'video/mp4' }] } }).image).toBeNull();
		expect(mediaFromAsset(undefined)).toEqual({ image: null, name: null });
	});
});

describe('normalizeMediaUrl', () => {
	it('allows https (and gateways for ipfs/ar) only', () => {
		expect(normalizeMediaUrl('ar://abc')).toBe('https://arweave.net/abc');
		expect(normalizeMediaUrl('http://insecure.test/a.png')).toBeNull();
		expect(normalizeMediaUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeMediaUrl('data:image/svg+xml,<svg/>')).toBeNull();
		expect(normalizeMediaUrl(42)).toBeNull();
	});
});

describe('resolveMintMedia', () => {
	const MINT = 'So11111111111111111111111111111111111111112';

	function stubFetch(result: unknown, calls: { n: number }) {
		globalThis.fetch = (async () => {
			calls.n++;
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
	}

	it('calls getAsset once, then serves from the D1 cache', async () => {
		const db = createTestD1([MIGRATIONS]);
		const calls = { n: 0 };
		stubFetch({ content: { links: { image: 'https://img.test/1.png' }, metadata: { name: 'One' } } }, calls);
		const deps = { db, rpcUrl: 'https://rpc.test' };
		expect(await resolveMintMedia(deps, MINT)).toEqual({ image: 'https://img.test/1.png', name: 'One' });
		expect(await resolveMintMedia(deps, MINT)).toEqual({ image: 'https://img.test/1.png', name: 'One' });
		expect(calls.n).toBe(1);
	});

	it('does not cache a failed request, and serves a stale hit on failure', async () => {
		const db = createTestD1([MIGRATIONS]);
		const deps = { db, rpcUrl: 'https://rpc.test' };
		globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
		expect(await resolveMintMedia(deps, MINT)).toEqual({ image: null, name: null });
		const row = await db.prepare('SELECT COUNT(*) AS n FROM revibase_mint_media').first<{ n: number }>();
		expect(row?.n).toBe(0);

		const calls = { n: 0 };
		stubFetch({ content: { links: { image: 'https://img.test/2.png' } } }, calls);
		await resolveMintMedia(deps, MINT, 1_000);
		globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
		expect((await resolveMintMedia(deps, MINT, 1_000 + 25 * 60 * 60 * 1000)).image).toBe('https://img.test/2.png');
	});
});
