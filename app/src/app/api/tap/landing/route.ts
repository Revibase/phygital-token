import { NextResponse, type NextRequest } from 'next/server';

import { getEnv, getRpc } from '#lib/server/env.ts';
import { responseCookies } from '#lib/server/http/cookies.ts';
import { readBrowseUnlock, setBrowseUnlock } from '#lib/server/session/cookies.ts';
import { handleTap, hasTapParams } from '#lib/server/tap/handle-tap.ts';

/** Verify a signed NFC URL, consume its counter, then redirect to a clean /accessory. */
export async function GET(request: NextRequest) {
	const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
	if (/prefetch|prerender/i.test(purpose)) {
		return new Response('Too early', { status: 425, headers: { 'cache-control': 'no-store' } });
	}
	const url = request.nextUrl;
	if (!hasTapParams(url.searchParams)) {
		return NextResponse.redirect(new URL('/accessory', url), 303);
	}

	const env = await getEnv();
	const outcome = await handleTap({ db: env.DB, rpc: getRpc(env) }, url.searchParams);
	const target = new URL('/accessory', url);
	if (!outcome.ok) {
		if (outcome.reason === 'replayed' && outcome.identifier) {
			const existing = await readBrowseUnlock(
				await requestCookiesReadonly(request),
				env.SESSION_SECRET
			);
			if (existing?.identifier !== outcome.identifier) target.pathname = `/tap/${outcome.reason}`;
		} else {
			target.pathname = `/tap/${outcome.reason}`;
		}
		const response = NextResponse.redirect(target, 303);
		response.headers.set('cache-control', 'no-store');
		return response;
	}

	const response = NextResponse.redirect(target, 303);
	response.headers.set('cache-control', 'no-store');
	await setBrowseUnlock(responseCookies(request, response), env.SESSION_SECRET, {
		pda: outcome.pda,
		identifier: outcome.identifier
	});
	return response;
}

async function requestCookiesReadonly(request: NextRequest) {
	return responseCookies(request, NextResponse.next());
}
