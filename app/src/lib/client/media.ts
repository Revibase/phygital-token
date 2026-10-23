import { address } from '@solana/kit';
import { fetchMaybePhygitalToken } from 'phygital-token-sdk';

import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import { EMPTY_MEDIA, fetchMintMedia, type MintMedia } from '#lib/shared/mint-media.ts';
import { proxied, proxiedImages } from './asset-image';
import { browserRpc, rpcUrl } from './rpc';

export async function fetchAccessoryMedia(pda: string): Promise<MintMedia> {
	const token = await fetchMaybePhygitalToken(browserRpc(), address(pda), {
		commitment: 'confirmed'
	});
	if (!token.exists || String(token.data.mint) === DEFAULT_PUBKEY) return EMPTY_MEDIA;
	const media = await fetchMintMedia(rpcUrl(), String(token.data.mint));
	const images = await proxiedImages([media.image, media.collectionImage]);
	return {
		...media,
		image: proxied(media.image, images),
		...(media.collectionImage ? { collectionImage: proxied(media.collectionImage, images) } : {})
	};
}
