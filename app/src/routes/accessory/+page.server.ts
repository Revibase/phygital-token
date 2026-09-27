import { redirect } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import { readAccessorySession } from '$lib/server/session/cookies';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	const session = await readAccessorySession(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');

	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) redirect(303, '/tap/unknown');
		return { accessory: toAccessoryView(resolved.pda, resolved.account), sessionExpiresAt: session.exp, loadError: false };
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err; // redirect
		return { accessory: null, sessionExpiresAt: session.exp, loadError: true };
	}
};
