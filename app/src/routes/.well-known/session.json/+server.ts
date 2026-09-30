import { json } from '@sveltejs/kit';

import { getEnv } from '$lib/server/env';
import { proofKey, proofKeySet } from '$lib/server/session/proof';
import type { RequestHandler } from './$types';

/** Public keys for verifying session proofs, as a JWKS. Any origin may read it. */
export const GET: RequestHandler = ({ platform }) => {
	const env = getEnv(platform);
	const key = proofKey(env.sessionProofKey);
	if (!key) return json({ error: 'Session proofs are not enabled.', code: 'not_found' }, { status: 404 });
	return json(proofKeySet(key, env.origin), {
		headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' }
	});
};
