import { address } from '@solana/kit';
import { fetchMaybePhygitalToken } from 'phygital-token-sdk';

import { DEFAULT_PUBKEY } from '$lib/shared/accessory-view';
import { fetchMintMedia, type MintMedia } from '$lib/shared/mint-media';
import { browserRpc, rpcUrl } from './rpc';

export type AccessoryMedia = MintMedia;

export const NO_MEDIA: AccessoryMedia = { image: null, name: null, collection: null, attributes: [] };

export async function fetchAccessoryMedia(pda: string): Promise<AccessoryMedia> {
	const token = await fetchMaybePhygitalToken(browserRpc(), address(pda), { commitment: 'confirmed' });
	if (!token.exists || String(token.data.mint) === DEFAULT_PUBKEY) return NO_MEDIA;
	return fetchMintMedia(rpcUrl(), String(token.data.mint));
}
