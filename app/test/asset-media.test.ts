import { describe, expect, it } from 'vitest';

import { mediaFromAsset, normalizeMediaUrl } from '#lib/shared/asset-media.ts';

describe('mediaFromAsset (Helius getAsset)', () => {
	it('uses links.image, then the raw file uri, and never a Helius CDN url', () => {
		expect(
			mediaFromAsset({
				content: {
					metadata: { name: 'Revibase #12' },
					links: { image: 'https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/raw.png' },
					files: [
						{
							uri: 'https://arweave.net/raw.png',
							mime: 'image/png'
						}
					]
				}
			})
		).toEqual({
			image: 'https://arweave.net/raw.png',
			name: 'Revibase #12'
		});
		expect(mediaFromAsset({ content: { links: { image: 'ipfs://bafy/1.png' } } }).image).toBe(
			'https://ipfs.io/ipfs/bafy/1.png'
		);
		expect(
			mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.webp', mime: 'image/webp' }] } })
				.image
		).toBe('https://x.test/a.webp');
		expect(
			mediaFromAsset({
				content: {
					links: { image: 'https://cdn.helius-rpc.com/cdn-cgi/image//https://ipfs.io/ipfs/abc' }
				}
			}).image
		).toBeNull();
	});

	it('ignores non-image files and missing content', () => {
		expect(
			mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.mp4', mime: 'video/mp4' }] } })
				.image
		).toBeNull();
		expect(mediaFromAsset(undefined)).toEqual({ image: null, name: null });
	});
});

describe('normalizeMediaUrl', () => {
	it('allows https (and gateways for ipfs/ar) only', () => {
		expect(normalizeMediaUrl('ar://abc')).toBe('https://arweave.net/abc');
		expect(normalizeMediaUrl('http://insecure.test/a.png')).toBeNull();
		expect(normalizeMediaUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeMediaUrl('data:image/svg+xml,<svg/>')).toBeNull();
		expect(
			normalizeMediaUrl('https://cdn.helius-rpc.com/cdn-cgi/image//https://ipfs.io/ipfs/abc')
		).toBeNull();
		expect(normalizeMediaUrl(42)).toBeNull();
	});
});
