function signedUrls(body: unknown): Record<string, string> {
	if (
		!body ||
		typeof body !== 'object' ||
		!('urls' in body) ||
		!body.urls ||
		typeof body.urls !== 'object'
	)
		return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(body.urls)) {
		if (typeof value === 'string') out[key] = value;
	}
	return out;
}

/** Rewrite publisher image URLs to signed same-origin links. Missing entries stay unloaded. */
export async function proxiedImages(
	urls: Array<string | null | undefined>
): Promise<Map<string, string>> {
	const unique = [...new Set(urls.filter((url): url is string => !!url))];
	if (!unique.length) return new Map();
	try {
		const res = await fetch('/api/asset-image', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ urls: unique })
		});
		if (!res.ok) return new Map();
		return new Map(Object.entries(signedUrls(await res.json())));
	} catch {
		return new Map();
	}
}

export function proxied(
	url: string | null | undefined,
	images: Map<string, string>
): string | null {
	if (!url) return url ?? null;
	return images.get(url) ?? null;
}
