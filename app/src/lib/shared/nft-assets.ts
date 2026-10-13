import { address, type Address } from '@solana/kit';
import { mediaFromAsset, type GetAssetResult } from './mint-media';

export type DasPriceInfo = { price_per_token?: number; total_price?: number; currency?: string };
export type NativeBalance = {
	lamports?: number | string;
	price_per_sol?: number;
	total_price?: number;
};

export type DasNftAsset = GetAssetResult & {
	id: string;
	token_info?: {
		symbol?: string;
		balance?: number | string;
		decimals?: number;
		token_program?: string;
		associated_token_address?: string;
		price_info?: DasPriceInfo;
	};
	burnt?: boolean;
	ownership?: {
		owner?: string;
		delegate?: string | null;
		frozen?: boolean;
		ownership_model?: string;
	};
	compression?: {
		compressed?: boolean;
		tree?: string;
		leaf_id?: number;
		data_hash?: string;
		creator_hash?: string;
		asset_data_hash?: string;
		flags?: number;
		leaf_schema_version?: number;
	};
};
export type NftHolding = {
	id: Address;
	kind: 'core' | 'compressed';
	name: string | null;
	symbol?: string | null;
	icon: string | null;
	frozen: boolean;
	priceUsd?: number | null;
};
export type AssetProof = { tree_id: string; root: string; proof: string[]; node_index?: number };

export async function dasRequest<T>(
	url: string,
	method: string,
	params: Record<string, unknown>
): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: `wallet-${method}`, method, params }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`Couldn’t load asset data (${response.status}).`);
	const body = await response.json<{ result?: T; error?: { message?: string } }>();
	if (body.error || !body.result) throw new Error(body.error?.message ?? 'Asset data unavailable.');
	return body.result;
}

/** DAS owns discovery only; transfer builders re-check chain ownership and fresh proofs. */
export function externalNftHolding(asset: DasNftAsset, wallet: Address): NftHolding | null {
	if (asset.burnt || asset.ownership?.owner !== wallet) return null;
	const kind = asset.compression?.compressed
		? 'compressed'
		: asset.interface === 'MplCoreAsset'
			? 'core'
			: null;
	if (!kind) return null;
	try {
		const media = mediaFromAsset(asset);
		return {
			id: address(asset.id),
			kind,
			name: media.name,
			symbol:
				(asset.token_info?.symbol ?? asset.content?.metadata?.symbol)?.trim().slice(0, 16) || null,
			icon: media.image,
			frozen: !!asset.ownership?.frozen || !!((asset.compression?.flags ?? 0) & 11)
		};
	} catch {
		return null;
	}
}

/** One paginated DAS inventory for fungibles, all NFT standards, metadata and prices. */
export async function fetchOwnerAssets(
	url: string,
	wallet: Address
): Promise<{
	assets: DasNftAsset[];
	nativeBalance?: NativeBalance;
	status: 'complete' | 'partial';
}> {
	const unique = new Map<string, DasNftAsset>();
	let nativeBalance: NativeBalance | undefined;
	const limit = 200;
	for (let page = 1; ; page++) {
		const before = unique.size;
		const result = await dasRequest<{ items: DasNftAsset[]; nativeBalance?: NativeBalance }>(
			url,
			'getAssetsByOwner',
			{
				ownerAddress: wallet,
				page,
				limit,
				displayOptions: {
					showFungible: true,
					showNativeBalance: true,
					showZeroBalance: false,
					showUnverifiedCollections: true
				}
			}
		);
		if (!Array.isArray(result.items)) throw new Error('Invalid wallet assets response.');
		if (page === 1) nativeBalance = result.nativeBalance;
		for (const asset of result.items) {
			if (!asset.id || asset.burnt || (asset.ownership?.owner && asset.ownership.owner !== wallet))
				continue;
			unique.set(asset.id, asset);
		}
		// A short page is the end marker; total may describe only the current page.
		if (result.items.length < limit)
			return { assets: [...unique.values()], nativeBalance, status: 'complete' };
		if (page > 1 && unique.size === before)
			return { assets: [...unique.values()], nativeBalance, status: 'partial' };
	}
}
