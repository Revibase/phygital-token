import { type NextRequest } from 'next/server';

import { fetchAssetImage, verifyAssetImageUrl } from '#lib/server/media/asset-images.ts';
import { getEnv } from '#lib/server/env.ts';

/** Outside `/api/` so it can be cached: the link is signed, not tied to a session. */
export async function GET(request: NextRequest) {
	const env = await getEnv();
	const target = request.nextUrl.searchParams.get('u');
	if (
		!(await verifyAssetImageUrl(env.SESSION_SECRET, target, request.nextUrl.searchParams.get('s')))
	) {
		return new Response('Not found', { status: 404 });
	}
	const image = await fetchAssetImage(target!);
	if (!image) {
		return new Response('Not found', {
			status: 404,
			headers: { 'cache-control': 'public, max-age=300' }
		});
	}
	return new Response(image.bytes, {
		headers: {
			'content-type': image.type,
			'cache-control': 'public, max-age=86400',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
}
