import { describe, expect, it } from 'vitest';

import { mediaFromAsset, normalizeMediaUrl, fetchMintMedia } from '$lib/shared/mint-media';

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
		).toEqual({ image: 'https://cdn.helius-rpc.com/cdn-cgi/image//https://arweave.net/raw.png', name: 'Revibase #12', collection: null, attributes: [] });
		expect(mediaFromAsset({ content: { links: { image: 'ipfs://bafy/1.png' } } }).image).toBe('https://ipfs.io/ipfs/bafy/1.png');
		expect(mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.webp', mime: 'image/webp' }] } }).image).toBe('https://x.test/a.webp');
	});

	it('uses NFT ownership from DAS independently of accessory linkage', () => {
		expect(mediaFromAsset({ownership:{owner:'nft-owner'},royalty:{basis_points:420},interface:'ProgrammableNFT',content:{json_uri:'ipfs://bafy/meta.json',metadata:{token_standard:'ProgrammableNonFungible'}}})).toMatchObject({owner:'nft-owner',royaltyBps:420,tokenStandard:'ProgrammableNonFungible',metadataUrl:'https://ipfs.io/ipfs/bafy/meta.json'});
		expect(mediaFromAsset({ownership:{owner:'not-an-exclusive-owner',ownership_model:'fungible'},royalty:{basis_points:-1},content:{}}).owner).toBeUndefined();
		expect(mediaFromAsset({content:{}}).owner).toBeUndefined();
	});
	it('reads description and collection artwork safely', () => {
		const media = mediaFromAsset({content:{metadata:{name:'NFT',description:'Full description'}},grouping:[{group_key:'collection',group_value:'collection-mint',collection_metadata:{name:'Collection',image:'ipfs://bafy/collection.png'}}]});
		expect(media).toMatchObject({description:'Full description',collection:'Collection',collectionAddress:'collection-mint',collectionImage:'https://ipfs.io/ipfs/bafy/collection.png'});
	});
	it('ignores non-image files and missing content', () => {
		expect(mediaFromAsset({ content: { files: [{ uri: 'https://x.test/a.mp4', mime: 'video/mp4' }] } }).image).toBeNull();
		expect(mediaFromAsset(undefined)).toEqual({ image: null, name: null, collection: null, attributes: [] });
	});

	it('reads the collection name and traits, dropping malformed ones', () => {
		const media = mediaFromAsset({
			content: {
				metadata: { name: 'Charizard', attributes: [{ trait_type: 'Rarity', value: 'Holo' }, { trait_type: 'Number', value: 4 }, { trait_type: '', value: 'x' }, { value: 'no label' }] }
			},
			grouping: [{ group_key: 'collection', collection_metadata: { name: 'Base Set' } }]
		});
		expect(media.collection).toBe('Base Set');
		expect(media.attributes).toEqual([{ label: 'Rarity', value: 'Holo' }, { label: 'Number', value: '4' }]);
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

describe('fetchMintMedia (straight from DAS)', () => {
	const MINT = 'So11111111111111111111111111111111111111112';

	function stubFetch(result: unknown, calls: { n: number; body?: unknown }) {
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			calls.n++;
			calls.body = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
		}) as typeof fetch;
	}

	it('asks DAS for the asset with collection metadata, on every call (no cache)', async () => {
		const calls: { n: number; body?: unknown } = { n: 0 };
		stubFetch({ content: { links: { image: 'https://img.test/1.png' }, metadata: { name: 'One' } } }, calls);
		expect(await fetchMintMedia('https://rpc.test', MINT)).toEqual({ image: 'https://img.test/1.png', name: 'One', collection: null, attributes: [] });
		await fetchMintMedia('https://rpc.test', MINT);
		expect(calls.n).toBe(2);
		expect(calls.body).toMatchObject({ method: 'getAsset', params: { id: MINT, options: { showCollectionMetadata: true } } });
	});

	it('fetches collection artwork when DAS only provides a collection address', async () => {
		globalThis.fetch = (async (_url, init) => {
			const id = JSON.parse(String(init?.body)).params.id;
			return Response.json({result: id === MINT ? {content:{metadata:{name:'NFT'}},grouping:[{group_key:'collection',group_value:'collection-mint'}]} : {content:{metadata:{name:'Collection'},links:{image:'https://img.test/collection.png'}}}});
		}) as typeof fetch;
		expect(await fetchMintMedia('https://rpc.test',MINT)).toMatchObject({name:'NFT',collection:'Collection',collectionImage:'https://img.test/collection.png'});
	});
	it('throws when DAS is unreachable, so a failure is never mistaken for "no metadata"', async () => {
		globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
		await expect(fetchMintMedia('https://rpc.test', MINT)).rejects.toThrow(/503/);
	});
});
