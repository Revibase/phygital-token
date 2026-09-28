import { json } from '@sveltejs/kit';

import { issueOwnerBrowseChallenge } from '$lib/server/accessory/owner-browse';
import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform }) =>
	json(await issueOwnerBrowseChallenge(getEnv(platform).db));
