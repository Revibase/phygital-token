import { json } from '@sveltejs/kit';

import { verifyOwnerBrowse } from '$lib/server/accessory/owner-browse';
import { getEnv, getRpc } from '$lib/server/env';
import { setOwnerBrowse } from '$lib/server/session/cookies';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	const env = getEnv(platform);
	let body: { challengeId?: unknown; pda?: unknown; address?: unknown; signature?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	try {
		const result = await verifyOwnerBrowse(
			{ db: env.db, rpc: getRpc(env) },
			{ challengeId: body.challengeId, pda: body.pda, address: body.address, signature: body.signature }
		);
		if (!result.ok) return json({ error: result.error, code: result.code }, { status: result.status });

		const session = await setOwnerBrowse(cookies, env.sessionSecret, {
			pda: result.pda,
			identifier: result.identifier,
			wallet: result.wallet
		});
		return json({ ok: true, mode: 'owner' as const, pda: session.pda, expiresAt: session.exp });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
