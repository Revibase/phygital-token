import { NextResponse, type NextRequest } from 'next/server';

import { fetchAccessory } from '#lib/server/accessory/resolve.ts';
import { loadProjectPage, withPageProxy } from '#lib/server/accessory/apps.ts';
import { getEnv, getRpc, solanaCluster } from '#lib/server/env.ts';
import { responseCookies } from '#lib/server/http/cookies.ts';
import { readAdmitSession } from '#lib/server/session/cookies.ts';
import { toAccessoryView } from '#lib/shared/accessory-view.ts';
import { EMPTY_PAGE } from '#lib/shared/project-page.ts';

/** The project's part of the tapped accessory's page: featured, accent and apps. */
export async function GET(request: NextRequest) {
	const env = await getEnv();
	const session = await readAdmitSession(
		responseCookies(request, NextResponse.next()),
		env.SESSION_SECRET
	);
	if (!session) {
		return NextResponse.json(
			{ error: 'Tap your accessory again.', code: 'expired' },
			{ status: 401 }
		);
	}
	try {
		const resolved = await fetchAccessory(getRpc(env), session.pda);
		if (!resolved) {
			return NextResponse.json(
				{ error: 'Accessory not found', code: 'not_found' },
				{ status: 404 }
			);
		}
		if (solanaCluster(env) === 'localnet') return NextResponse.json({ page: EMPTY_PAGE });
		const accessory = toAccessoryView(resolved.pda, resolved.account);
		const { page } = await loadProjectPage(env.NEXT_PUBLIC_SOLANA_RPC_URL, accessory);
		return NextResponse.json({ page: await withPageProxy(page, env.SESSION_SECRET) });
	} catch {
		return NextResponse.json(
			{ error: 'Couldn’t reach the network. Try again.', code: 'network' },
			{ status: 502 }
		);
	}
}
