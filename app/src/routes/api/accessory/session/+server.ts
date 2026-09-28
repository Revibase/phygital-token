import { json } from '@sveltejs/kit';

import { getEnv } from '$lib/server/env';
import { readBrowseUnlock, readOwnerBrowse } from '$lib/server/session/cookies';
import type { RequestHandler } from './$types';

/** Which admit cookie is live — browse_unlock wins when both somehow remain. */
export const GET: RequestHandler = async ({ cookies, platform }) => {
	const env = getEnv(platform);
	const browse = await readBrowseUnlock(cookies, env.sessionSecret);
	if (browse) {
		return json({ mode: 'accessory' as const, pda: browse.pda, expiresAt: browse.exp });
	}
	const owner = await readOwnerBrowse(cookies, env.sessionSecret);
	if (owner) {
		return json({ mode: 'owner' as const, pda: owner.pda, expiresAt: owner.exp });
	}
	return json({ mode: null, pda: null });
};
