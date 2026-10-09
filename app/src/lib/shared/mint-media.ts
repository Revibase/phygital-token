
export type MintTrait = { label: string; value: string };
export type MintMedia = { image: string | null; name: string | null; collection: string | null; description?: string | null; collectionImage?: string | null; collectionAddress?: string | null; owner?: string | null; tokenStandard?: string | null; metadataUrl?: string | null; royaltyBps?: number | null; attributes: MintTrait[] };

export const EMPTY_MEDIA: MintMedia = { image: null, name: null, collection: null, attributes: [] };
const MAX_TRAITS = 100;

const TIMEOUT_MS = 3_000;

export function normalizeMediaUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let value = raw.trim();
	if (!value || value.length > 2048) return null;
	if (value.startsWith('ipfs://')) value = `https://ipfs.io/ipfs/${value.slice(7).replace(/^ipfs\//, '')}`;
	else if (value.startsWith('ar://')) value = `https://arweave.net/${value.slice(5)}`;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export type GetAssetResult = {
	interface?: string;
	ownership?: { owner?: string; ownership_model?: string };
	royalty?: { basis_points?: number };
	content?: {
		json_uri?: string;
		metadata?: { name?: string; description?: string; token_standard?: string; attributes?: Array<{ trait_type?: unknown; value?: unknown }> };
		links?: { image?: string; external_url?: string };
		files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
	};
	grouping?: Array<{ group_key?: string; group_value?: string; collection_metadata?: { name?: string; image?: string; description?: string } }>;
};

const clip = (v: unknown, max: number): string | null => {
	if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
	if (typeof v !== 'string') return null;
	const t = v.trim().slice(0, max);
	return t || null;
};

export function mediaFromAsset(asset: GetAssetResult | undefined): MintMedia {
	const content = asset?.content;
	if (!content) return EMPTY_MEDIA;
	const images = (content.files ?? []).filter((f) => !f.mime || f.mime.startsWith('image/'));
	const image =
		normalizeMediaUrl(images[0]?.cdn_uri) ?? normalizeMediaUrl(content.links?.image) ?? normalizeMediaUrl(images[0]?.uri);
	const name = clip(content.metadata?.name, 120);
	const collection = clip(asset?.grouping?.find((g) => g.group_key === 'collection')?.collection_metadata?.name, 120);
	const attributes: MintTrait[] = [];
	for (const a of content.metadata?.attributes ?? []) {
		const label = clip(a?.trait_type, 120);
		const value = clip(a?.value, 1000);
		if (label && value) attributes.push({ label, value });
		if (attributes.length === MAX_TRAITS) break;
	}
	const group = asset?.grouping?.find((g) => g.group_key === 'collection');
	return { image, name, collection, attributes,
		...(asset?.ownership?.ownership_model !== 'fungible' && clip(asset?.ownership?.owner, 64) ? { owner: clip(asset?.ownership?.owner, 64) } : {}),
		...(clip(content.metadata?.token_standard ?? asset?.interface, 80) ? { tokenStandard: clip(content.metadata?.token_standard ?? asset?.interface, 80) } : {}),
		...(normalizeMediaUrl(content.json_uri) ? { metadataUrl: normalizeMediaUrl(content.json_uri) } : {}),
		...(typeof asset?.royalty?.basis_points === 'number' && Number.isInteger(asset.royalty.basis_points) && asset.royalty.basis_points >= 0 && asset.royalty.basis_points <= 10000 ? { royaltyBps: asset.royalty.basis_points } : {}),
		...(clip(content.metadata?.description, 6000) ? { description: clip(content.metadata?.description, 6000) } : {}),
		...(group?.group_value ? { collectionAddress: group.group_value } : {}),
		...(normalizeMediaUrl(group?.collection_metadata?.image) ? { collectionImage: normalizeMediaUrl(group?.collection_metadata?.image) } : {})
	};
}

/** DAS `getAsset` for one mint, with collection metadata. `undefined` when DAS doesn't know the asset. */
export async function fetchAsset(rpcUrl: string, mint: string): Promise<GetAssetResult | undefined> {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 'revibase-media', method: 'getAsset', params: { id: mint, options: { showCollectionMetadata: true } } }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`getAsset ${res.status}`);
	const body = (await res.json()) as { result?: GetAssetResult; error?: { message?: string } };
	if (body.error) throw new Error(body.error.message ?? 'getAsset error');
	return body.result;
}

/**
 * Fetch a mint's artwork, name, collection and traits straight from DAS, from
 * the browser (`SOLANA_RPC_URL` is a public proxy, so it holds no secret).
 * Nothing is stored; the client memoises per page session. Throws when DAS is
 * unreachable, so callers can tell "no metadata" apart from "couldn't ask".
 */
export async function fetchMintMedia(rpcUrl: string, mint: string): Promise<MintMedia> {
	const media = mediaFromAsset(await fetchAsset(rpcUrl, mint));
	if (media.collectionAddress && (!media.collectionImage || !media.collection)) {
		try {
			const collection = mediaFromAsset(await fetchAsset(rpcUrl, media.collectionAddress));
			media.collection ??= collection.name;
			media.collectionImage ??= collection.image;
		} catch { /* The NFT remains usable if collection metadata is unavailable. */ }
	}
	return media;
}
