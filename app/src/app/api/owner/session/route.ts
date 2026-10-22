import { NextResponse, type NextRequest } from 'next/server';

import { verifyOwnerLogin } from '#lib/server/accessory/owner-browse.ts';
import { getEnv } from '#lib/server/env.ts';
import { responseCookies } from '#lib/server/http/cookies.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { clearCookie, setOwnerSession } from '#lib/server/session/cookies.ts';

/** Log in: one signed message proves this browser controls the wallet. */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as {
		challengeId?: unknown;
		address?: unknown;
		signature?: unknown;
	};
	const result = await verifyOwnerLogin(env.DB, body, Date.now());
	if (!result.ok) {
		return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
	}
	const pending = NextResponse.json(null);
	const session = await setOwnerSession(
		responseCookies(request, pending),
		env.SESSION_SECRET,
		result.wallet
	);
	const response = NextResponse.json({ ok: true, wallet: session.wallet, expiresAt: session.exp });
	for (const cookie of pending.headers.getSetCookie()) response.headers.append('set-cookie', cookie);
	return response;
}

/** Log out (wallet disconnected): drop the login and any owner_browse it issued. */
export async function DELETE(request: NextRequest) {
	const response = NextResponse.json({ ok: true });
	const jar = responseCookies(request, response);
	clearCookie(jar, 'os');
	clearCookie(jar, 'ob');
	return response;
}
