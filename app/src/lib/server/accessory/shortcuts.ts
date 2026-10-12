import { fetchAsset, type GetAssetResult } from '$lib/shared/mint-media';
import { resolveShortcuts, shortcutsFileUrl, type Shortcut } from '$lib/shared/shortcuts';
import type { AccessoryView } from '$lib/shared/types';

const TIMEOUT_MS = 3_000;
const MAX_BYTES = 64 * 1024;
const CACHE_TTL_S = 600;

/**
 * Fetched by the Worker, never the browser: no CORS needed, and the project never sees the tapper's IP.
 * Any failure on the project's side means no shortcuts.
 */
export async function fetchShortcutsFile(fileUrl: string): Promise<unknown> {
	try {
		const res = await fetch(fileUrl, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true }
		} as RequestInit);
		if (!res.ok) return null;
		if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
		const text = await res.text();
		if (text.length > MAX_BYTES) return null;
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function collectionOf(asset: GetAssetResult | undefined): string | null {
	return asset?.grouping?.find((g) => g.group_key === 'collection')?.group_value ?? null;
}

export type ProjectShortcuts = { externalUrl: string | null; shortcuts: Shortcut[] };

/** Throws only when DAS is unreachable, so the client can retry. */
export async function loadShortcuts(rpcUrl: string, accessory: AccessoryView): Promise<ProjectShortcuts> {
	const none = { externalUrl: null, shortcuts: [] };
	if (!accessory.mint) return none;
	const asset = await fetchAsset(rpcUrl, accessory.mint);
	const raw = asset?.content?.links?.external_url;
	const fileUrl = shortcutsFileUrl(raw);
	if (!fileUrl || typeof raw !== 'string') return none;

	const externalUrl = raw.trim();
	const file = await fetchShortcutsFile(fileUrl);
	return {
		externalUrl,
		shortcuts: resolveShortcuts(file, {
			externalUrl,
			tokenId: accessory.mint,
			collectionId: collectionOf(asset),
			ownerAddress: accessory.owner
		})
	};
}
