import { json } from '@sveltejs/kit';

import { getEnv, getRpc } from '$lib/server/env';
import { attachAccessoryToPairing } from '$lib/server/link/service';
import { readPairSession, setBrowseUnlock } from '$lib/server/session/cookies';
import { verifyResume } from '$lib/server/tap/resume';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	const env = getEnv(platform);
	let body: { challengeId?: unknown; response?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		const result = await verifyResume(
			{ db: env.db, rpc: getRpc(env) },
			{ challengeId: body.challengeId, response: body.response }
		);
		if (!result.ok) return json({ error: result.error, code: result.code }, { status: result.status });

		const session = await setBrowseUnlock(cookies, env.sessionSecret, { pda: result.pda, identifier: result.identifier });
		const pair = await readPairSession(cookies, env.sessionSecret);
		if (pair && (await attachAccessoryToPairing(env, pair.linkId, session))) {
			return json({ next: `/accessory/link?link=${encodeURIComponent(pair.linkId)}` });
		}
		return json({ next: '/accessory' });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
