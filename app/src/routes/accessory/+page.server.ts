import { redirect } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import { readAdmitSession } from '$lib/server/session/cookies';
import type { PageServerLoad } from './$types';

/**
 * Accessory page: gated by browse_unlock (physical tap / Hold) or
 * owner_browse (linked wallet opened it from Home). Same admit model as
 * phygital-wallet's browse_unlock | authority_browse.
 */
export const load: PageServerLoad = async ({ cookies, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');

	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) redirect(303, '/tap/unknown');
		return {
			accessory: toAccessoryView(resolved.pda, resolved.account),
			sessionExpiresAt: session.exp,
			admit: session.t === 'bu' ? 'browse_unlock' : 'owner_browse',
			loadError: false
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err; // redirect
		return { accessory: null, sessionExpiresAt: session.exp, admit: null, loadError: true };
	}
};
