import { redirect } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/shared/accessory-view';
import { getEnv, getRpc } from '$lib/server/env';
import { readBrowseUnlock } from '$lib/server/session/cookies';
import type { PageServerLoad } from './$types';

/** Linking needs browse_unlock (a fresh physical tap). Owner_browse is view-only. */
export const load: PageServerLoad = async ({ cookies, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	const session = await readBrowseUnlock(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');
	const resolved = await fetchAccessory(getRpc(env), session.pda).catch(() => null);
	if (!resolved) redirect(303, '/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	if (!accessory.canLink) redirect(303, '/accessory');
	return { accessory, rpId: env.rpId };
};
