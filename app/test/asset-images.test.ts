import { afterEach, describe, expect, it } from 'vitest';

import {
	ASSET_IMAGE_PATH,
	MAX_ASSET_BYTES,
	assetImagePath,
	assetImagePaths,
	fetchAssetImage,
	sourcesFor,
	verifyAssetImageUrl
} from '#lib/server/media/asset-images.ts';

const SECRET = 'x'.repeat(32);
const URL_ = 'https://arweave.net/raw.png';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(16).fill(0)]);

describe('asset image proxy', () => {
	it('signs only the real https image url', async () => {
		const path = await assetImagePath(SECRET, URL_);
		const link = new URL(path, 'https://portal.revibase.com');
		expect(link.pathname).toBe(ASSET_IMAGE_PATH);
		const [u, s] = [link.searchParams.get('u'), link.searchParams.get('s')];
		expect(u).toBe(URL_);
		expect(await verifyAssetImageUrl(SECRET, u, s)).toBe(true);
		expect(await verifyAssetImageUrl(SECRET, 'https://evil.test/x.png', s)).toBe(false);
		expect(
			await verifyAssetImageUrl(
				SECRET,
				'https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/raw.png',
				s
			)
		).toBe(false);
	});

	it('drops CDN urls and anything that is not the normalized https url', async () => {
		const signed = await assetImagePaths(SECRET, [
			URL_,
			'https://cdn.helius-rpc.com/cdn-cgi/image//https://ipfs.io/ipfs/abc',
			'ipfs://abc',
			URL_
		]);
		expect(Object.keys(signed)).toEqual([URL_]);
		expect(signed[URL_]).toBe(await assetImagePath(SECRET, URL_));
	});

	it('fetches an ipfs.io url from a gateway that serves the CID', () => {
		expect(sourcesFor('https://ipfs.io/ipfs/Qmabc')).toEqual([
			'https://gateway.pinata.cloud/ipfs/Qmabc',
			'https://ipfs.filebase.io/ipfs/Qmabc'
		]);
		expect(sourcesFor(URL_)).toEqual([URL_]);
	});
});

describe('fetchAssetImage', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('uses the first gateway that returns a raster image', async () => {
		const seen: string[] = [];
		globalThis.fetch = async (input) => {
			const url = String(input);
			seen.push(url);
			if (url.startsWith('https://ipfs.filebase.io/')) return new Response(JPEG.slice());
			return new Response('blocked', { status: 403 });
		};
		expect(await fetchAssetImage('https://ipfs.io/ipfs/Qmabc')).toMatchObject({
			type: 'image/jpeg'
		});
		expect(seen).toEqual([
			'https://gateway.pinata.cloud/ipfs/Qmabc',
			'https://ipfs.filebase.io/ipfs/Qmabc'
		]);
	});

	it('refuses files over the size cap and non-images', async () => {
		globalThis.fetch = async () =>
			new Response(new Uint8Array(8), {
				headers: { 'content-length': String(MAX_ASSET_BYTES + 1) }
			});
		expect(await fetchAssetImage(URL_)).toBeNull();
		globalThis.fetch = async () => new Response('<svg></svg>');
		expect(await fetchAssetImage(URL_)).toBeNull();
		expect(
			await fetchAssetImage('https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/a.png')
		).toBeNull();
	});
});
