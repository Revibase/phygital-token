import { error } from '@sveltejs/kit';
import { address } from '@solana/kit';
import { findWalletPda } from 'phygital-token-sdk';
import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/shared/accessory-view';
import { getEnv, getRpc } from '$lib/server/env';
import { readAdmitSession } from '$lib/server/session/cookies';
import type { PageServerLoad } from './$types';

/** Public: balances are on-chain data, and every write needs the owner's signature. */
export const load: PageServerLoad = async ({ params, platform, setHeaders, cookies }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.pda)) error(404, 'Accessory not found');
	const env = getEnv(platform);
	const resolved = await fetchAccessory(getRpc(env), params.pda);
	if (!resolved) error(404, 'Accessory not found');
	const [wallet] = await findWalletPda({ phygitalToken: address(resolved.pda) });
	const session = await readAdmitSession(cookies, env.sessionSecret);
	return { accessory: toAccessoryView(resolved.pda, resolved.account), wallet: String(wallet), accessoryHref: session?.pda === resolved.pda ? '/accessory' : '/' };
};
