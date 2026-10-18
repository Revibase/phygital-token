import { json } from '@sveltejs/kit';

import { verifyOwnerLogin } from '#lib/server/accessory/owner-browse.ts';
import { getEnv } from '#lib/server/env.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { clearCookie, setOwnerSession } from '#lib/server/session/cookies.ts';
import type { RequestHandler } from './$types';

/** Log in: one signed message proves this browser controls the wallet. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const env = getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { challengeId?: unknown; address?: unknown; signature?: unknown };
	const result = await verifyOwnerLogin(env.db, body);
	if (!result.ok)
		return json({ error: result.error, code: result.code }, { status: result.status });
	const session = await setOwnerSession(cookies, env.sessionSecret, result.wallet);
	return json({ ok: true, wallet: session.wallet, expiresAt: session.exp });
};

/** Log out (wallet disconnected): drop the login and any owner_browse it issued. */
export const DELETE: RequestHandler = ({ cookies }) => {
	clearCookie(cookies, 'os');
	clearCookie(cookies, 'ob');
	return json({ ok: true });
};
