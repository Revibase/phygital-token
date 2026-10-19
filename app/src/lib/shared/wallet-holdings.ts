import { address, type Address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

import { formatTokenAmount, SOL_DECIMALS } from './amount';
import { mediaFromAsset, type GetAssetResult } from './mint-media';

export const TOKEN_2022_PROGRAM_ADDRESS = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/** A fungible token the wallet holds, with the exact on-chain balance and account. */
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
	priceUsd: number | null;
};

export type WalletHoldings = {
	wallet: Address;
	lamports: bigint;
	tokens: TokenHolding[];
	solPriceUsd: number | null;
};

type DasPriceInfo = { price_per_token?: number; currency?: string };
type DasAsset = GetAssetResult & {
	id: string;
	token_info?: { symbol?: string; price_info?: DasPriceInfo };
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

function usdPrice(info: DasPriceInfo | undefined): number | null {
	if (!info || !['USD', 'USDC'].includes(info.currency?.toUpperCase() ?? '')) return null;
	const price = info.price_per_token;
	return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
}

/** NFTs held in token accounts (one unit, no decimals) aren't sent from here. */
const isFungible = (token: TokenHolding) => !(token.decimals === 0 && token.amount === 1n);

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
			icon: null,
			priceUsd: null
		});
	}
	return tokens.filter(isFungible);
}

/** Names, icons and prices from DAS; balances never come from it. Null when the RPC has no DAS. */
async function fetchDasInventory(
	rpcUrl: string,
	wallet: Address
): Promise<{ assets: DasAsset[]; solPriceUsd: number | null } | null> {
	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 'wallet-holdings',
				method: 'getAssetsByOwner',
				params: {
					ownerAddress: wallet,
					page: 1,
					limit: 1000,
					displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false }
				}
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) return null;
		const body = (await response.json()) as {
			result?: { items?: DasAsset[]; nativeBalance?: { price_per_sol?: number } };
		};
		if (!Array.isArray(body.result?.items)) return null;
		const price = body.result.nativeBalance?.price_per_sol;
		return {
			assets: body.result.items,
			solPriceUsd: typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null
		};
	} catch {
		return null;
	}
}

export async function fetchWalletHoldings(
	rpc: Rpc<SolanaRpcApi>,
	rpcUrl: string,
	wallet: Address
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
		fetchDasInventory(rpcUrl, wallet)
	]);
	const indexed = new Map(inventory?.assets.map((asset) => [asset.id, asset]) ?? []);
	const tokens = [...spl, ...t22]
		.map((token) => {
			const asset = indexed.get(token.mint);
			const media = mediaFromAsset(asset);
			const symbol = (asset?.token_info?.symbol ?? asset?.content?.metadata?.symbol)
				?.trim()
				.slice(0, 16);
			return {
				...token,
				name: media.name,
				icon: media.image,
				symbol: symbol || null,
				priceUsd: usdPrice(asset?.token_info?.price_info)
			};
		})
		.sort(
			(a, b) =>
				Number(!a.symbol) - Number(!b.symbol) ||
				(a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint)
		);
	return {
		wallet,
		lamports: BigInt(lamports),
		tokens,
		solPriceUsd: inventory?.solPriceUsd ?? null
	};
}

/** Total USD value, or null when nothing held has a price. */
export function portfolioUsd(holdings: WalletHoldings): number | null {
	const value = (raw: bigint, decimals: number, price: number | null) =>
		price === null ? null : Number(formatTokenAmount(raw, decimals)) * price;
	const parts = [
		value(holdings.lamports, SOL_DECIMALS, holdings.solPriceUsd),
		...holdings.tokens.map((t) => value(t.amount, t.decimals, t.priceUsd))
	].filter((v): v is number => v !== null && Number.isFinite(v));
	return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export const formatUsd = (value: number) =>
	new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 2
	}).format(value);

export const tokenLabel = (token: TokenHolding) =>
	token.symbol ?? token.name ?? `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`;
