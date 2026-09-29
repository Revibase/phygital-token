import { json } from '@sveltejs/kit';

import { getEnv } from '$lib/server/env';
import { issueResumeChallenge } from '$lib/server/tap/resume';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) => {
	const env = getEnv(platform);
	return json(await issueResumeChallenge(env.db));
};
