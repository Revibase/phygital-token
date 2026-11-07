import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { EnrollScreen } from '#lib/components/app/EnrollScreen';
import { getEnv } from '#lib/server/env.ts';
import { readOnlyCookies } from '#lib/server/http/cookies.ts';
import { enrollChallenge, readEnrollSession } from '#lib/server/session/cookies.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';

export const dynamic = 'force-dynamic';

/** Reached from a verified tap of a card with no token yet (the enroll cookie). */
export default async function Page() {
	const env = await getEnv();
	const store = await cookies();
	const session = await readEnrollSession(readOnlyCookies(store), env.SESSION_SECRET);
	if (!session) redirect('/tap/unknown');
	// Rendered with the page: iOS only shows the prompt when it starts straight from the
	// click, and this challenge lasts as long as the cookie, so nothing is fetched or refreshed.
	const challenge = bytesToBase64Url(await enrollChallenge(env.SESSION_SECRET, session));
	return <EnrollScreen challenge={challenge} />;
}
