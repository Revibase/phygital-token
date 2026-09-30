import { redirect } from '@sveltejs/kit';

import { FRAME_ALLOW, FRAME_SANDBOX, isFramable } from '$lib/server/accessory/embed';
import { fetchAccessory } from '$lib/server/accessory/resolve';
import { loadShortcuts, markProofs, withSessionProofs } from '$lib/server/accessory/shortcuts';
import { getEnv, getRpc } from '$lib/server/env';
import { readAdmitSession } from '$lib/server/session/cookies';
import { proofKey } from '$lib/server/session/proof';
import { toAccessoryView } from '$lib/shared/accessory-view';
import type { PageServerLoad } from './$types';

/**
 * Everything is looked up again from the session; `n` only picks a position in the project's file.
 * The origin must not be ours: the sandbox allows same-origin, which is only safe for someone else's.
 */
export const load: PageServerLoad = async ({ cookies, platform, params, locals, setHeaders, url }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const env = getEnv(platform);
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session) redirect(303, '/tap/expired');

	const index = Number(params.n);
	if (!Number.isInteger(index) || index < 0) redirect(303, '/accessory');
	const resolved = await fetchAccessory(getRpc(env), session.pda).catch(() => null);
	if (!resolved) redirect(303, '/accessory');
	const accessory = toAccessoryView(resolved.pda, resolved.account);
	const project = await loadShortcuts(env.rpcUrl, accessory).catch(() => null);
	const picked = project?.shortcuts[index];
	if (!project || !picked?.immerse) redirect(303, '/accessory');

	const origin = new URL(picked.href).origin;
	if (origin === url.origin || origin === env.origin) redirect(303, '/accessory');

	const proofs = { key: proofKey(env.sessionProofKey), issuer: env.origin, session, accessory };
	const [marked] = markProofs({ ...project, shortcuts: [picked] }, proofs);
	const openHref = marked.proof ? `/shortcut/${index}` : picked.href;
	const host = new URL(picked.href).hostname.replace(/^www\./, '');

	if (!(await isFramable(picked.href, env.origin))) {
		return { label: picked.label, host, openHref, frame: null };
	}
	// Only now, with the frame certain to load, is its proof signed.
	const [framed] = withSessionProofs({ ...project, shortcuts: [picked] }, proofs);
	locals.frameSrc = origin;
	return { label: picked.label, host, openHref, frame: { src: framed.href, sandbox: FRAME_SANDBOX, allow: FRAME_ALLOW } };
};
