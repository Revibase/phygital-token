import { json } from '@sveltejs/kit';

import { getEnv, getRpc } from '#lib/server/env.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { setBrowseUnlock } from '#lib/server/session/cookies.ts';
import { verifyResume } from '#lib/server/tap/resume.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const env = getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { challengeId?: unknown; response?: unknown };
	try {
		const result = await verifyResume(
			{ db: env.db, rpc: getRpc(env), origin: url.origin },
			{ challengeId: body.challengeId, response: body.response }
		);
		if (!result.ok)
			return json({ error: result.error, code: result.code }, { status: result.status });

		await setBrowseUnlock(cookies, env.sessionSecret, {
			pda: result.pda,
			identifier: result.identifier
		});
		return json({ next: '/accessory' });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
