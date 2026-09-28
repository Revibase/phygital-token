import { redirect } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import { readBrowseUnlock } from '$lib/server/session/cookies';
import type { PageServerLoad } from './$types';

/** Linking needs browse_unlock (a fresh physical tap). Owner_browse is view-only. */
export const load: PageServerLoad = async ({ cookies, platform, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	const session = await readBrowseUnlock(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');
	const resolved = await fetchAccessory(getRpc(env), session.pda).catch(() => null);
	if (!resolved) redirect(303, '/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	// `link` = a desktop pairing this phone joined; access is enforced by the API.
	const pairedLinkId = url.searchParams.get('link');
	if (!accessory.canLink && !pairedLinkId) redirect(303, '/accessory');
	return { accessory, pairedLinkId: pairedLinkId && /^[A-Za-z0-9_-]{16,32}$/.test(pairedLinkId) ? pairedLinkId : null };
};
