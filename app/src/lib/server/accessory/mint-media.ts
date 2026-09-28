/**
 * Artwork for an accessory's bound `mint`, via Helius DAS `getAsset`, so the
 * app shows the collectible instead of the Revibase logo. Prefers the Helius
 * CDN copy of the image (fast, cached), then the metadata's own image link.
 * Only https URLs are returned (ipfs:// and ar:// go through public gateways).
 */

export type MintMedia = { image: string | null; name: string | null };

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 30 * 60 * 1000;
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
		metadata?: { name?: string };
		links?: { image?: string };
		files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
	};
};

/** Pick the image out of a DAS `getAsset` result. */
export function mediaFromAsset(asset: GetAssetResult | undefined): MintMedia {
	const content = asset?.content;
	if (!content) return { image: null, name: null };
	const images = (content.files ?? []).filter((f) => !f.mime || f.mime.startsWith('image/'));
	const image =
		normalizeMediaUrl(images[0]?.cdn_uri) ?? normalizeMediaUrl(content.links?.image) ?? normalizeMediaUrl(images[0]?.uri);
	const name = typeof content.metadata?.name === 'string' ? content.metadata.name.slice(0, 120) || null : null;
	return { image, name };
}

async function getAsset(rpcUrl: string, mint: string): Promise<MintMedia> {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 'revibase-media', method: 'getAsset', params: { id: mint } }),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`getAsset ${res.status}`);
	const body = (await res.json()) as { result?: GetAssetResult; error?: { message?: string } };
	if (body.error) throw new Error(body.error.message ?? 'getAsset error');
	return mediaFromAsset(body.result);
}

export async function resolveMintMedia(
	/** `rpcUrl` is our Helius RPC (SOLANA_RPC_URL), which serves DAS methods. */
	deps: { db: D1Database; rpcUrl: string },
	mint: string,
	now = Date.now()
): Promise<MintMedia> {
	const cached = await deps.db
		.prepare('SELECT image, name, fetched_at FROM revibase_mint_media WHERE mint = ?')
		.bind(mint)
		.first<{ image: string | null; name: string | null; fetched_at: number }>();
	if (cached && now - cached.fetched_at < (cached.image ? HIT_TTL_MS : MISS_TTL_MS)) {
		return { image: cached.image, name: cached.name };
	}

	let media: MintMedia;
	try {
		media = await getAsset(deps.rpcUrl, mint);
	} catch {
		// Transient failure: serve a stale hit if we have one, and don't cache the miss.
		return cached ? { image: cached.image, name: cached.name } : { image: null, name: null };
	}

	await deps.db
		.prepare(
			`INSERT INTO revibase_mint_media (mint, image, name, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(mint) DO UPDATE SET image = excluded.image, name = excluded.name, fetched_at = excluded.fetched_at`
		)
		.bind(mint, media.image, media.name, now)
		.run();
	return media;
}
