import { type NextRequest } from 'next/server';

import { json } from '#lib/server/http/cookies.ts';
import { assetImagePaths } from '#lib/server/media/asset-images.ts';
import { getEnv } from '#lib/server/env.ts';

/** Signs the real image URLs the browser already resolved, so `<img>` can load them from this origin. */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request.', code: 'invalid' }, 400);
	}
	const urls = (body as { urls?: unknown }).urls;
	if (!Array.isArray(urls) || urls.some((url) => typeof url !== 'string')) {
		return json({ error: 'Invalid request.', code: 'invalid' }, 400);
	}
	return json({ urls: await assetImagePaths(env.SESSION_SECRET, urls) });
}
