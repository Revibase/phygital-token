import { json } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { loadShortcuts, markProofs } from '$lib/server/accessory/shortcuts';
import { withIconProxy } from '$lib/server/accessory/shortcut-icons';
import { withFramingCheck } from '$lib/server/accessory/embed';
import { proofKey } from '$lib/server/session/proof';
import { toAccessoryView } from '$lib/shared/accessory-view';
import { getEnv, getRpc } from '$lib/server/env';
import { readAdmitSession } from '$lib/server/session/cookies';
import type { RequestHandler } from './$types';

/** No proofs in the list: `/shortcut/[n]` signs one when a shortcut is opened. */
export const GET: RequestHandler = async ({ cookies, platform }) => {
	const env = getEnv(platform);
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session) return json({ error: 'Tap your accessory again.', code: 'expired' }, { status: 401 });
	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) return json({ error: 'Accessory not found', code: 'not_found' }, { status: 404 });
		const accessory = toAccessoryView(resolved.pda, resolved.account);
		const loaded = await loadShortcuts(env.rpcUrl, accessory);
		const project = { ...loaded, shortcuts: await withFramingCheck(loaded.shortcuts, env.origin) };
		const marked = markProofs(project, { key: proofKey(env.sessionProofKey), issuer: env.origin, session, accessory });
		return json({ shortcuts: await withIconProxy(marked, env.sessionSecret) });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.', code: 'network' }, { status: 502 });
	}
};
