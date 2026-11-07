import { NextResponse, type NextRequest } from 'next/server';

import { getEnv, getRpc } from '#lib/server/env.ts';
import { readOnlyCookies, responseCookies } from '#lib/server/http/cookies.ts';
import {
	readBrowseUnlock,
	setBrowseUnlock,
	setEnrollSession
} from '#lib/server/session/cookies.ts';
import { handleTap, hasTapParams } from '#lib/server/tap/handle-tap.ts';

/**
 * Verify a signed NFC URL, consume its counter, then redirect to a clean
 * /accessory, or to /enroll when the card has no token yet.
 */
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
	const redirect = (pathname: string) => {
		const response = NextResponse.redirect(new URL(pathname, url), 303);
		response.headers.set('cache-control', 'no-store');
		return response;
	};

	if (outcome.ok) {
		const response = redirect('/accessory');
		await setBrowseUnlock(responseCookies(request, response), env.SESSION_SECRET, {
			pda: outcome.pda,
			identifier: outcome.identifier
		});
		return response;
	}
	if (outcome.reason === 'unknown' && outcome.identifier) {
		// A verified tap with no token yet: let this browser enroll it. The tap's key is
		// self-asserted, so enrollment itself proves the card is genuine (its attestation).
		const response = redirect('/enroll');
		await setEnrollSession(
			responseCookies(request, response),
			env.SESSION_SECRET,
			outcome.identifier
		);
		return response;
	}
	if (outcome.reason === 'replayed' && outcome.identifier) {
		// A replay of the tap this browser already holds (e.g. a reload) keeps its session.
		const existing = await readBrowseUnlock(readOnlyCookies(request.cookies), env.SESSION_SECRET);
		if (existing?.identifier === outcome.identifier) return redirect('/accessory');
	}
	return redirect(`/tap/${outcome.reason}`);
}
