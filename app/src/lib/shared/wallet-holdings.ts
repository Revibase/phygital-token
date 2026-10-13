import { address, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

import {
	fetchOwnerAssets,
	externalNftHolding,
	type DasPriceInfo,
	type NftHolding
} from './nft-assets';
import { formatCompactTokenAmount, formatTokenAmount, SOL_DECIMALS } from './amount';
import { mediaFromAsset } from './mint-media';

export { TOKEN_2022_PROGRAM_ADDRESS } from './programs';
import { TOKEN_2022_PROGRAM_ADDRESS } from './programs';

export type TokenHolding = {
	tokenAccount: Address;
	mint: Address;
	tokenProgram: Address;
	amount: bigint;
	decimals: number;
	frozen: boolean;
	name: string | null;
	symbol: string | null;
	icon: string | null;
	/** DAS identifies the standard; zero decimals alone does not mean NFT. */
	tokenStandard?: string | null;
	priceUsd?: number | null;
};

export type WalletHoldings = {
	wallet: Address;
	lamports: bigint;
	tokens: TokenHolding[];
	nfts?: NftHolding[];
	nftStatus?: 'complete' | 'partial' | 'unavailable';
	solPriceUsd?: number | null;
};

type ParsedTokenAccount = {
	pubkey: string;
	account: {
		data: {
			parsed?: {
				info?: {
					mint?: string;
					state?: string;
					tokenAmount?: { amount?: string; decimals?: number };
				};
			};
		};
	};
};

export function usdPrice(info: DasPriceInfo | undefined): number | null {
	if (!info || !['USD', 'USDC'].includes(info.currency?.toUpperCase() ?? '')) return null;
	return typeof info.price_per_token === 'number' &&
		Number.isFinite(info.price_per_token) &&
		info.price_per_token >= 0
		? info.price_per_token
		: null;
}

export function portfolioValue(holdings: WalletHoldings): {
	usd: number | null;
	unpriced: number;
	partial: boolean;
} {
	let total = 0;
	let priced = 0;
	const unknown = new Set<string>();
	const add = (id: string, raw: bigint, decimals: number, price: number | null | undefined) => {
		if (raw <= 0n) return;
		const value =
			typeof price === 'number' && Number.isFinite(price) && price >= 0
				? Number(formatTokenAmount(raw, decimals)) * price
				: NaN;
		if (!Number.isFinite(value) || !Number.isFinite(total + value)) unknown.add(id);
		else {
			total += value;
			priced++;
		}
	};
	add('native:SOL', holdings.lamports, SOL_DECIMALS, holdings.solPriceUsd);
	for (const token of holdings.tokens)
		add(token.mint, token.amount, token.decimals, token.priceUsd);
	for (const nft of holdings.nfts ?? []) add(nft.id, 1n, 0, nft.priceUsd);
	const empty = holdings.lamports === 0n && !holdings.tokens.length && !holdings.nfts?.length;
	const partial = holdings.nftStatus !== 'complete';
	return { usd: priced ? total : empty && !partial ? 0 : null, unpriced: unknown.size, partial };
}

export const formatUsd = (value: number) =>
	new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2
	}).format(value);

export function parseTokenAccounts(
	value: readonly ParsedTokenAccount[],
	tokenProgram: Address
): TokenHolding[] {
	const tokens: TokenHolding[] = [];
	for (const { pubkey, account } of value) {
		const info = account.data.parsed?.info;
		const amount = BigInt(info?.tokenAmount?.amount ?? '0');
		if (!info?.mint || amount === 0n) continue;
		tokens.push({
			tokenAccount: address(pubkey),
			mint: address(info.mint),
			tokenProgram,
			amount,
			decimals: info.tokenAmount?.decimals ?? 0,
			frozen: info.state === 'frozen',
			name: null,
			symbol: null,
			icon: null
		});
	}
	return tokens;
}

export async function fetchWalletHoldings(
	rpc: Rpc<SolanaRpcApi>,
	wallet: Address,
	dasUrl: string | null
): Promise<WalletHoldings> {
	const byProgram = (programId: Address) =>
		rpc
			.getTokenAccountsByOwner(
				wallet,
				{ programId },
				{ encoding: 'jsonParsed', commitment: 'confirmed' }
			)
			.send()
			.then(({ value }) => parseTokenAccounts(value as unknown as ParsedTokenAccount[], programId));
	const [{ value: lamports }, spl, t22, inventory] = await Promise.all([
		rpc.getBalance(wallet, { commitment: 'confirmed' }).send(),
		byProgram(TOKEN_PROGRAM_ADDRESS),
		byProgram(TOKEN_2022_PROGRAM_ADDRESS),
		dasUrl ? fetchOwnerAssets(dasUrl, wallet).catch(() => null) : Promise.resolve(null)
	]);
	const raw = [...spl, ...t22];
	const indexed = new Map(inventory?.assets.map((asset) => [asset.id, asset]) ?? []);
	// Exact balances and account addresses cover non-ATA holdings and keep transfers safe.
	const tokens = raw
		.map((token) => {
			const asset = indexed.get(token.mint);
			const media = mediaFromAsset(asset);
			return {
				...token,
				name: media.name,
				icon: media.image,
				symbol:
					(asset?.token_info?.symbol ?? asset?.content?.metadata?.symbol)?.trim().slice(0, 16) ||
					null,
				tokenStandard: media.tokenStandard,
				priceUsd: usdPrice(asset?.token_info?.price_info)
			};
		})
		.sort(
			(a, b) =>
				Number(!a.symbol) - Number(!b.symbol) ||
				(a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint)
		);
	const nfts = (inventory?.assets ?? []).flatMap((asset) => {
		const nft = externalNftHolding(asset, wallet);
		return nft ? [{ ...nft, priceUsd: usdPrice(asset.token_info?.price_info) }] : [];
	});
	const price = inventory?.nativeBalance?.price_per_sol;
	return {
		wallet,
		lamports: BigInt(lamports),
		tokens,
		nfts,
		nftStatus: inventory?.status ?? 'unavailable',
		solPriceUsd: typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null
	};
}

export function describeHoldings(holdings: WalletHoldings): string | null {
	const parts: string[] = [];
	if (holdings.lamports > 0n)
		parts.push(`${formatCompactTokenAmount(holdings.lamports, SOL_DECIMALS)} SOL`);
	const nfts = holdings.tokens.filter(isCollectible).length + (holdings.nfts?.length ?? 0);
	const n = holdings.tokens.filter((t) => !isCollectible(t)).length;
	if (n) parts.push(`${n} token${n === 1 ? '' : 's'}`);
	if (nfts) parts.push(`${nfts} NFT${nfts === 1 ? '' : 's'}`);
	return parts.length ? parts.join(' and ') : null;
}

/** Only token-account-backed NFTs appear in holdings; Core/compressed assets use separate programs. */
export function isCollectible(token: TokenHolding): boolean {
	return (
		token.decimals === 0 &&
		token.amount === 1n &&
		[
			'NonFungible',
			'NonFungibleEdition',
			'ProgrammableNonFungible',
			'ProgrammableNonFungibleEdition',
			'V1_NFT',
			'V2_NFT',
			'ProgrammableNFT',
			'LEGACY_NFT',
			'LegacyNFT'
		].includes(token.tokenStandard ?? '')
	);
}

export function transferRestriction(token: TokenHolding): string | null {
	if (isProgrammableNft(token)) return null; // pNFT token accounts are deliberately frozen; Token Metadata enforces their rules.
	return token.frozen ? 'This asset is frozen and can’t be sent.' : null;
}

export function isProgrammableNft(token: TokenHolding): boolean {
	return isCollectible(token) && !!token.tokenStandard?.startsWith('Programmable');
}
