import { error, redirect } from '@sveltejs/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/shared/accessory-view';
import { getEnv, getRpc } from '$lib/server/env';
import {
	readAdmitSession,
	readBrowseUnlock,
	readPairSession,
	setBrowseUnlock
} from '$lib/server/session/cookies';
import { attachAccessoryToPairing } from '$lib/server/link/service';
import { handleTap, hasTapParams } from '$lib/server/tap/handle-tap';
import type { PageServerLoad } from './$types';

/**
 * NFC landing: `https://<app>/accessory?pk=…&c=…&n=…&s=…`.
 *
 * The tap is an authentication ceremony, not a page view. It is verified and
 * its counter consumed server-side, then we 303 to a clean `/accessory` so the
 * raw signed parameters are never rendered, cached, or kept as a history entry.
 */
async function processTap(
	{ url, request, cookies, platform }: Parameters<PageServerLoad>[0],
	env: ReturnType<typeof getEnv>
): Promise<void> {
	// Link previewers / speculative prefetch must not burn a single-use counter.
	const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
	// Don't fall through and render the previously unlocked accessory for a new tap.
	if (/prefetch|prerender/i.test(purpose)) error(425, 'Too early');

	const outcome = await handleTap({ db: env.db, rpc: getRpc(env) }, url.searchParams);

	if (!outcome.ok) {
		// Opened the same URL twice (or taps arrived out of order) while this
		// browser already holds a session for the same accessory: carry on.
		if (outcome.reason === 'replayed' && outcome.identifier) {
			const existing = await readBrowseUnlock(cookies, env.sessionSecret);
			if (existing?.identifier === outcome.identifier) redirect(303, '/accessory');
		}
		redirect(303, `/tap/${outcome.reason}`);
	}

	const session = await setBrowseUnlock(cookies, env.sessionSecret, {
		pda: outcome.accessory.pda,
		identifier: outcome.identifier
	});

	// Phone that scanned a desktop pairing QR first: attach this accessory to it.
	const pair = await readPairSession(cookies, env.sessionSecret);
	if (pair && (await attachAccessoryToPairing(env, pair.linkId, session))) {
		redirect(303, `/accessory/link?link=${encodeURIComponent(pair.linkId)}`);
	}

	redirect(303, '/accessory');
}

export const load: PageServerLoad = async (event) => {
	const { cookies, platform, setHeaders, url } = event;
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	if (hasTapParams(url.searchParams)) await processTap(event, env);
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');

	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) redirect(303, '/tap/unknown');
		return {
			accessory: toAccessoryView(resolved.pda, resolved.account),
			sessionExpiresAt: session.exp,
			admit: session.t === 'bu' ? 'browse_unlock' : 'owner_browse',
			loadError: false
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err; // redirect
		return { accessory: null, sessionExpiresAt: session.exp, admit: null, loadError: true };
	}
};
