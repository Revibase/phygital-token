import { address } from '@solana/kit';
import { fetchPhygitalTokensByOwner, findPhygitalTokenPda } from 'phygital-token-sdk';

import { toAccessoryView } from '$lib/shared/accessory-view';
import type { AccessoryView } from '$lib/shared/types';
import { browserRpc } from './rpc';

export async function fetchWalletAccessories(wallet: string): Promise<AccessoryView[]> {
	const tokens = await fetchPhygitalTokensByOwner(browserRpc(), address(wallet));
	return Promise.all(tokens.map(async (t) => toAccessoryView(String(await findPhygitalTokenPda(t.publicKey)), t)));
}
