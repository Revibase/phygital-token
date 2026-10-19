import { json } from '@sveltejs/kit';

import { isWalletAddress, issueOwnerLoginChallenge } from '#lib/server/accessory/owner-browse.ts';
import { getEnv } from '#lib/server/env.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import type { RequestHandler } from './$types';

/** A Sign-In With Solana message for this wallet, bound to the origin the page is served from. */
export const POST: RequestHandler = async ({ request, url }) => {
	const env = getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { address?: unknown };
	if (!isWalletAddress(body.address))
		return json({ error: 'Missing wallet.', code: 'bad_request' }, { status: 400 });
	return json(
		await issueOwnerLoginChallenge(env.db, {
			domain: url.host,
			uri: url.origin,
			address: body.address,
			cluster: env.cluster
		})
	);
};
