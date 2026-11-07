/** A wallet token's display name and icon, normalised from its DAS asset. */
export type AssetMedia = { image: string | null; name: string | null };

export function normalizeMediaUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let value = raw.trim();
	if (!value || value.length > 2048) return null;
	if (value.startsWith('ipfs://'))
		value = `https://ipfs.io/ipfs/${value.slice(7).replace(/^ipfs\//, '')}`;
	else if (value.startsWith('ar://')) value = `https://arweave.net/${value.slice(5)}`;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.hostname === 'cdn.helius-rpc.com') return null;
		return url.href;
	} catch {
		return null;
	}
}

export type GetAssetResult = {
	content?: {
		metadata?: { symbol?: string; name?: string };
		links?: { image?: string };
		files?: Array<{ uri?: string; mime?: string }>;
	};
};

export function mediaFromAsset(asset: GetAssetResult | undefined): AssetMedia {
	const content = asset?.content;
	if (!content) return { image: null, name: null };
	const images = (content.files ?? []).filter((f) => !f.mime || f.mime.startsWith('image/'));
	const image =
		normalizeMediaUrl(content.links?.image) ??
		images.map((f) => normalizeMediaUrl(f.uri)).find(Boolean) ??
		null;
	const name =
		typeof content.metadata?.name === 'string' ? content.metadata.name.trim().slice(0, 120) : '';
	return { image, name: name || null };
}
