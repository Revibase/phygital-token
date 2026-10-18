import { json } from '@sveltejs/kit';

import { getEnv } from '#lib/server/env.ts';
import { issueResumeChallenge } from '#lib/server/tap/resume.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const env = getEnv();
	return json(await issueResumeChallenge(env.db));
};
