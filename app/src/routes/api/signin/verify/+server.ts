import { json } from '@sveltejs/kit';

import { getEnv, getRpc } from '$lib/server/env';
import { verifySignIn } from '$lib/server/signin/signin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = getEnv(platform);
	let body: { challengeId?: unknown; response?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		const result = await verifySignIn(
			{ db: env.db, rpc: getRpc(env), rpId: env.rpId, origin: env.origin },
			{ challengeId: body.challengeId, response: body.response }
		);
		if (!result.ok) return json({ error: result.error, code: result.code }, { status: result.status });
		return json({ accessory: result.accessory, wallet: result.wallet });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
