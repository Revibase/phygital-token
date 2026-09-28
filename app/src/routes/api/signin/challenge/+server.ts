import { json } from '@sveltejs/kit';

import { getEnv } from '$lib/server/env';
import { issueSignInChallenge } from '$lib/server/signin/signin';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) => {
	const env = getEnv(platform);
	return json(await issueSignInChallenge(env.db));
};
