import { NextResponse, type NextRequest } from 'next/server';

import { verifyOwnerBrowse } from '#lib/server/accessory/owner-browse.ts';
import { getEnv, getRpc } from '#lib/server/env.ts';
import { responseCookies } from '#lib/server/http/cookies.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { readOwnerSession, setOwnerBrowse } from '#lib/server/session/cookies.ts';

/** Open an accessory from Home using the wallet login (`os`); no signature needed. */
export async function POST(request: NextRequest) {
	const env = await getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { pda?: unknown; address?: unknown };
	const login = await readOwnerSession(responseCookies(request, NextResponse.next()), env.SESSION_SECRET);
	if (!login || login.wallet !== body.address) {
		return NextResponse.json({ error: 'Sign in with your wallet.', code: 'unauthenticated' }, { status: 401 });
	}
	try {
		const result = await verifyOwnerBrowse(getRpc(env), login.wallet, body.pda);
		if (!result.ok) {
			return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
		}
		const pending = NextResponse.json(null);
		const session = await setOwnerBrowse(responseCookies(request, pending), env.SESSION_SECRET, {
			...result,
			wallet: login.wallet
		});
		const response = NextResponse.json({
			ok: true,
			mode: 'owner' as const,
			pda: session.pda,
			expiresAt: session.exp
		});
		for (const cookie of pending.headers.getSetCookie()) response.headers.append('set-cookie', cookie);
		return response;
	} catch {
		return NextResponse.json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
}
