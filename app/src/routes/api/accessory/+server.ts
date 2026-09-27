import { json } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import { readAccessorySession } from '$lib/server/session/cookies';
import type { RequestHandler } from './$types';

/** Fresh on-chain view of the accessory in this browser's tap session. */
export const GET: RequestHandler = async ({ cookies, platform }) => {
	const env = getEnv(platform);
	const session = await readAccessorySession(cookies, env.sessionSecret);
	if (!session) return json({ error: 'Tap your accessory again.', code: 'expired' }, { status: 401 });
	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) return json({ error: 'Accessory not found', code: 'not_found' }, { status: 404 });
		return json({ accessory: toAccessoryView(resolved.pda, resolved.account), sessionExpiresAt: session.exp });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.', code: 'network' }, { status: 502 });
	}
};
