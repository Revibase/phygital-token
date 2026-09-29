import { json } from '@sveltejs/kit';

import { verifyOwnerBrowse } from '$lib/server/accessory/owner-browse';
import { getEnv, getRpc } from '$lib/server/env';
import { readOwnerSession, setOwnerBrowse } from '$lib/server/session/cookies';
import type { RequestHandler } from './$types';

/** Open an accessory from Home using the wallet login (`os`); no signature needed. */
export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	const env = getEnv(platform);
	const body = (await request.json().catch(() => ({}))) as { pda?: unknown; address?: unknown };
	// Not logged in as the wallet the page is using: the client logs in again and retries.
	const login = await readOwnerSession(cookies, env.sessionSecret);
	if (!login || login.wallet !== body.address) {
		return json({ error: 'Sign in with your wallet.', code: 'unauthenticated' }, { status: 401 });
	}
	try {
		const result = await verifyOwnerBrowse(getRpc(env), login.wallet, body.pda);
		if (!result.ok) return json({ error: result.error, code: result.code }, { status: result.status });

		const session = await setOwnerBrowse(cookies, env.sessionSecret, { ...result, wallet: login.wallet });
		return json({ ok: true, mode: 'owner' as const, pda: session.pda, expiresAt: session.exp });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
