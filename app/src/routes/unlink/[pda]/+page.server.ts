import { error } from '@sveltejs/kit';
import { fetchAccessory } from '$lib/server/accessory/resolve';
import { toAccessoryView } from '$lib/shared/accessory-view';
import { getEnv, getRpc } from '$lib/server/env';
import type { PageServerLoad } from './$types';

/** Public account data only. Unlinking still requires the current linked wallet's on-chain signature. */
export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.pda)) error(404, 'Accessory not found');
	const env = getEnv(platform);
	const resolved = await fetchAccessory(getRpc(env), params.pda);
	if (!resolved) error(404, 'Accessory not found');
	return { accessory: toAccessoryView(resolved.pda, resolved.account) };
};
