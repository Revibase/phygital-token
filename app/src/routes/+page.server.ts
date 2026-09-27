import { redirect } from '@sveltejs/kit';

import { getEnv, getRpc } from '$lib/server/env';
import { attachAccessoryToPairing } from '$lib/server/link/service';
import {
	readAccessorySession,
	readPairSession,
	setAccessorySession
} from '$lib/server/session/cookies';
import { handleTap, hasTapParams } from '$lib/server/tap/handle-tap';
import type { PageServerLoad } from './$types';

/**
 * NFC landing: `https://<app>/?pk=…&c=…&n=…&s=…`.
 *
 * The tap is an authentication ceremony, not a page view. It is verified and
 * its counter consumed server-side, then we 303 to a clean URL so the raw
 * signed parameters are never rendered, cached, or kept as a history entry.
 */
export const load: PageServerLoad = async ({ url, request, cookies, platform, setHeaders }) => {
	if (!hasTapParams(url.searchParams)) return {};

	setHeaders({ 'cache-control': 'no-store' });

	// Link previewers / speculative prefetch must not burn a single-use counter.
	const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
	if (/prefetch|prerender/i.test(purpose)) return {};

	const env = getEnv(platform);
	const outcome = await handleTap({ tapDb: env.tapDb, appDb: env.appDb, rpc: getRpc(env) }, url.searchParams);

	if (!outcome.ok) {
		// Opened the same URL twice (or taps arrived out of order) while this
		// browser already holds a session for the same accessory: carry on.
		if (outcome.reason === 'replayed' && outcome.identifier) {
			const existing = await readAccessorySession(cookies, env.sessionSecret);
			if (existing?.identifier === outcome.identifier) redirect(303, '/accessory');
		}
		redirect(303, `/tap/${outcome.reason}`);
	}

	const session = await setAccessorySession(cookies, env.sessionSecret, {
		pda: outcome.accessory.pda,
		identifier: outcome.identifier
	});

	// Phone that scanned a desktop pairing QR first: attach this accessory to it.
	const pair = await readPairSession(cookies, env.sessionSecret);
	if (pair && (await attachAccessoryToPairing(env, pair.linkId, session))) {
		redirect(303, `/accessory/link?link=${encodeURIComponent(pair.linkId)}`);
	}

	redirect(303, '/accessory');
};
