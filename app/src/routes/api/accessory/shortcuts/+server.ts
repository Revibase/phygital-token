import { json } from '@sveltejs/kit';

import { fetchAccessory } from '#lib/server/accessory/resolve.ts';
import { loadShortcuts } from '#lib/server/accessory/shortcuts.ts';
import { withIconProxy } from '#lib/server/accessory/shortcut-icons.ts';
import { toAccessoryView } from '#lib/shared/accessory-view.ts';
import { getEnv, getRpc } from '#lib/server/env.ts';
import { readAdmitSession } from '#lib/server/session/cookies.ts';
import type { RequestHandler } from './$types';

/** Authenticated accessory shortcuts, opened directly by the client. */
export const GET: RequestHandler = async ({ cookies }) => {
	const env = getEnv();
	const session = await readAdmitSession(cookies, env.sessionSecret);
	if (!session)
		return json({ error: 'Tap your accessory again.', code: 'expired' }, { status: 401 });
	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved)
			return json({ error: 'Accessory not found', code: 'not_found' }, { status: 404 });
		// The local test validator has no DAS metadata endpoint, so its minted test NFT
		// cannot provide project shortcut metadata. Treat that as an empty project grid.
		if (env.cluster === 'localnet') return json({ shortcuts: [] });
		const accessory = toAccessoryView(resolved.pda, resolved.account);
		const project = await loadShortcuts(env.rpcUrl, accessory);
		return json({ shortcuts: await withIconProxy(project.shortcuts, env.sessionSecret) });
	} catch {
		return json(
			{ error: 'Couldn’t reach the network. Try again.', code: 'network' },
			{ status: 502 }
		);
	}
};
