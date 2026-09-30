import { fetchIconImage, verifyIconUrl } from '$lib/server/accessory/shortcut-icons';
import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

/** Outside `/api/` so it can be cached: the link is signed, not tied to a session. */
export const GET: RequestHandler = async ({ url, platform }) => {
	const env = getEnv(platform);
	const target = url.searchParams.get('u');
	if (!(await verifyIconUrl(env.sessionSecret, target, url.searchParams.get('s')))) {
		return new Response('Not found', { status: 404 });
	}
	const icon = await fetchIconImage(target!);
	if (!icon) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
	return new Response(icon.bytes, {
		headers: {
			'content-type': icon.type,
			'cache-control': 'public, max-age=86400',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
};
