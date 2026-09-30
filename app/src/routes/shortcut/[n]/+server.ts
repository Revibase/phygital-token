import { fetchAccessory } from '$lib/server/accessory/resolve';
import { fromOtherSite, loadShortcuts, openedLocation, withSessionProofs } from '$lib/server/accessory/shortcuts';
import { getEnv, getRpc } from '$lib/server/env';
import { readAdmitSession } from '$lib/server/session/cookies';
import { proofKey } from '$lib/server/session/proof';
import { toAccessoryView } from '$lib/shared/accessory-view';
import type { RequestHandler } from './$types';

const back = (to: string) => new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

/**
 * Signs the proof at the click and redirects. A real navigation, so iOS still counts new tabs and wallet
 * deep links as the user's own tap. `Sec-Fetch-Site` stops other sites sending viewers here to mint proofs.
 */
export const GET: RequestHandler = async ({ cookies, platform, params, url, request }) => {
	if (fromOtherSite(request.headers)) return back('/accessory');

	const env = getEnv(platform);
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session) return back('/tap/expired');

	const index = Number(params.n);
	if (!Number.isInteger(index) || index < 0) return back('/accessory');
	const resolved = await fetchAccessory(getRpc(env), session.pda).catch(() => null);
	if (!resolved) return back('/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	const project = await loadShortcuts(env.rpcUrl, accessory).catch(() => null);
	const picked = project?.shortcuts[index];
	if (!project || !picked) return back('/accessory');

	const [opened] = withSessionProofs({ ...project, shortcuts: [picked] }, { key: proofKey(env.sessionProofKey), issuer: env.origin, session, accessory });
	return back(openedLocation(opened, url.searchParams.get('wallet'), url.origin) ?? '/accessory');
};
