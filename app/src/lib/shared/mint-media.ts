
export type MintTrait = { label: string; value: string };
export type MintMedia = { image: string | null; name: string | null; collection: string | null; attributes: MintTrait[] };

export const EMPTY_MEDIA: MintMedia = { image: null, name: null, collection: null, attributes: [] };
const MAX_TRAITS = 24;

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

type GetAssetResult = {
	content?: {
		metadata?: { name?: string; attributes?: Array<{ trait_type?: unknown; value?: unknown }> };
		links?: { image?: string };
		files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
	};
	grouping?: Array<{ group_key?: string; collection_metadata?: { name?: string } }>;
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
		const label = clip(a?.trait_type, 40);
		const value = clip(a?.value, 80);
		if (label && value) attributes.push({ label, value });
		if (attributes.length === MAX_TRAITS) break;
	}
	return { image, name, collection, attributes };
}

async function getAsset(rpcUrl: string, mint: string): Promise<MintMedia> {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 'revibase-media', method: 'getAsset', params: { id: mint, options: { showCollectionMetadata: true } } }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`getAsset ${res.status}`);
	const body = (await res.json()) as { result?: GetAssetResult; error?: { message?: string } };
	if (body.error) throw new Error(body.error.message ?? 'getAsset error');
	return mediaFromAsset(body.result);
}

/**
 * Fetch a mint's artwork, name, collection and traits straight from DAS, from
 * the browser (`SOLANA_RPC_URL` is a public proxy, so it holds no secret).
 * Nothing is stored; the client memoises per page session. Throws when DAS is
 * unreachable, so callers can tell "no metadata" apart from "couldn't ask".
 */
export const fetchMintMedia = getAsset;
