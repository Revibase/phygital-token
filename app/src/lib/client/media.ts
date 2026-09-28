export type AccessoryMedia = { image: string | null; name: string | null };

const cache = new Map<string, Promise<AccessoryMedia>>();
const NONE: AccessoryMedia = { image: null, name: null };

/**
 * Artwork for an accessory's bound mint (server: Helius `getAsset`, cached).
 * Memoised per page session so moving between screens never refetches or
 * flashes the placeholder again.
 */
export function accessoryMedia(pda: string): Promise<AccessoryMedia> {
	let pending = cache.get(pda);
	if (!pending) {
		pending = fetch(`/api/accessory/${encodeURIComponent(pda)}/media`)
			.then((r) => (r.ok ? (r.json() as Promise<AccessoryMedia>) : NONE))
			.catch(() => NONE);
		cache.set(pda, pending);
	}
	return pending;
}
