import { json } from '@sveltejs/kit';

import { getEnv, getRpc } from '$lib/server/env';
import { setBrowseUnlock } from '$lib/server/session/cookies';
import { verifyResume } from '$lib/server/tap/resume';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	let body: { challengeId?: unknown; response?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		const result = await verifyResume(
			{ db: env.db, rpc: getRpc(env), origin: url.origin },
			{ challengeId: body.challengeId, response: body.response }
		);
		if (!result.ok) return json({ error: result.error, code: result.code }, { status: result.status });

		await setBrowseUnlock(cookies, env.sessionSecret, { pda: result.pda, identifier: result.identifier });
		return json({ next: '/accessory' });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
