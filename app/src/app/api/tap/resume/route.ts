import { NextResponse, type NextRequest } from 'next/server';

import { getEnv, getRpc } from '#lib/server/env.ts';
import { responseCookies } from '#lib/server/http/cookies.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { setBrowseUnlock } from '#lib/server/session/cookies.ts';
import { verifyResume } from '#lib/server/tap/resume.ts';

export async function POST(request: NextRequest) {
	const env = await getEnv();
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const body = read.body as { challengeId?: unknown; response?: unknown };
	try {
		const result = await verifyResume(
			{ db: env.DB, rpc: getRpc(env), origin: request.nextUrl.origin },
			{ challengeId: body.challengeId, response: body.response }
		);
		if (!result.ok) {
			return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
		}
		const response = NextResponse.json({ next: '/accessory' });
		await setBrowseUnlock(responseCookies(request, response), env.SESSION_SECRET, {
			pda: result.pda,
			identifier: result.identifier
		});
		return response;
	} catch {
		return NextResponse.json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
}
