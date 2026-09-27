import { json } from '@sveltejs/kit';
import { address, isAddress } from '@solana/kit';
import { fetchPhygitalTokensByLinkedWallet, findPhygitalTokenPda } from 'phygital-token-sdk';

import { toAccessoryView } from '$lib/server/accessory/view';
import { getEnv, getRpc } from '$lib/server/env';
import type { RequestHandler } from './$types';

/** Recovery (`/wallet`): accessories currently linked to a wallet. Public on-chain data. */
export const GET: RequestHandler = async ({ params, platform }) => {
	if (!isAddress(params.address)) return json({ error: 'Invalid wallet address' }, { status: 400 });
	const env = getEnv(platform);
	try {
		const tokens = await fetchPhygitalTokensByLinkedWallet(getRpc(env), address(params.address));
		const views = await Promise.all(
			tokens.map(async (t) => toAccessoryView(String(await findPhygitalTokenPda(t.publicKey)), t))
		);
		return json({ accessories: views }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return json({ error: 'Couldn’t reach the network. Try again.' }, { status: 502 });
	}
};
