import { address } from '@solana/kit';
import { fetchMaybePhygitalToken } from 'phygital-token-sdk';

import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import { EMPTY_MEDIA, fetchMintMedia, type MintMedia } from '#lib/shared/mint-media.ts';
import { browserRpc, rpcUrl } from './rpc';

export async function fetchAccessoryMedia(pda: string): Promise<MintMedia> {
	const token = await fetchMaybePhygitalToken(browserRpc(), address(pda), {
		commitment: 'confirmed'
	});
	if (!token.exists || String(token.data.mint) === DEFAULT_PUBKEY) return EMPTY_MEDIA;
	return fetchMintMedia(rpcUrl(), String(token.data.mint));
}
