import { json } from '@sveltejs/kit';

import { isWalletAddress, issueOwnerLoginChallenge } from '$lib/server/accessory/owner-browse';
import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

/** A Sign-In With Solana message for this wallet, bound to the origin the page is served from. */
export const POST: RequestHandler = async ({ request, url, platform }) => {
	const env = getEnv(platform);
	const body = (await request.json().catch(() => ({}))) as { address?: unknown };
	if (!isWalletAddress(body.address)) return json({ error: 'Missing wallet.', code: 'bad_request' }, { status: 400 });
	return json(await issueOwnerLoginChallenge(env.db, { domain: url.host, uri: url.origin, address: body.address, cluster: env.cluster }));
};
