import { json } from '@sveltejs/kit';
import { isAddress } from '@solana/kit';

import { fetchAccessory } from '$lib/server/accessory/resolve';
import { resolveMintMedia } from '$lib/server/accessory/mint-media';
import { DEFAULT_PUBKEY } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import type { RequestHandler } from './$types';

/**
 * Artwork for an accessory's bound mint. Keyed by the accessory account (not
 * an arbitrary mint), so this can't be used to fetch metadata for any token.
 * Public on-chain data; cached at the edge and in D1.
 */
export const GET: RequestHandler = async ({ params, platform }) => {
	if (!isAddress(params.pda)) return json({ image: null, name: null }, { status: 400 });
	const env = getEnv(platform);
	const rpc = getRpc(env);
	try {
		const accessory = await fetchAccessory(rpc, params.pda);
		const mint = accessory ? String(accessory.account.mint) : DEFAULT_PUBKEY;
		if (mint === DEFAULT_PUBKEY) {
			return json({ image: null, name: null }, { headers: { 'cache-control': 'public, max-age=300' } });
		}
		const media = await resolveMintMedia({ db: env.db, rpcUrl: env.rpcUrl }, mint);
		return json(media, { headers: { 'cache-control': `public, max-age=${media.image ? 3600 : 300}` } });
	} catch {
		return json({ image: null, name: null }, { status: 502, headers: { 'cache-control': 'no-store' } });
	}
};
