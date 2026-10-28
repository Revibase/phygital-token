import { withIconProxy } from '#lib/server/accessory/app-icons.ts';
import { assetImagePath } from '#lib/server/media/asset-images.ts';
import { fetchAsset, type GetAssetResult } from '#lib/shared/mint-media.ts';
import { appsFileUrl } from '#lib/shared/project-apps.ts';
import { EMPTY_PAGE, resolvePage, type ProjectPage } from '#lib/shared/project-page.ts';
import type { AccessoryView } from '#lib/shared/types.ts';

const TIMEOUT_MS = 3_000;
const MAX_BYTES = 64 * 1024;
const CACHE_TTL_S = 600;

/**
 * Fetched by the Worker, never the browser: no CORS needed, and the project never sees the tapper's IP.
 * Any failure on the project's side means no apps.
 */
export async function fetchAppsFile(fileUrl: string): Promise<unknown> {
	try {
		const res = await fetch(fileUrl, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true }
		});
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

export type LoadedPage = { externalUrl: string | null; page: ProjectPage };

/** Throws only when DAS is unreachable, so the client can retry. */
export async function loadProjectPage(
	rpcUrl: string,
	accessory: AccessoryView
): Promise<LoadedPage> {
	const none = { externalUrl: null, page: EMPTY_PAGE };
	if (!accessory.mint) return none;
	const asset = await fetchAsset(rpcUrl, accessory.mint);
	const raw = asset?.content?.links?.external_url;
	const fileUrl = appsFileUrl(raw);
	if (!fileUrl || typeof raw !== 'string') return none;

	const externalUrl = raw.trim();
	const file = await fetchAppsFile(fileUrl);
	return {
		externalUrl,
		page: resolvePage(file, {
			externalUrl,
			mint: accessory.mint,
			collection: collectionOf(asset),
			owner: accessory.owner,
			accessory: accessory.pda
		})
	};
}

/** Every image on the project page, served from our origin: icons by the icon proxy, art by the asset proxy. */
export async function withPageProxy(page: ProjectPage, secret: string): Promise<ProjectPage> {
	const art = (url: string | null) => (url ? assetImagePath(secret, url) : null);
	const bg = page.style.background;
	const [apps, featured, background] = await Promise.all([
		withIconProxy(page.apps, secret),
		Promise.all(
			Object.entries(page.featured).map(async ([key, f]) => [
				key,
				{ ...f, image: await art(f.image) }
			])
		),
		bg?.kind === 'image' ? assetImagePath(secret, bg.image).then((image) => ({ ...bg, image })) : bg
	]);
	return {
		...page,
		apps,
		featured: Object.fromEntries(featured) as ProjectPage['featured'],
		style: { ...page.style, background }
	};
}
