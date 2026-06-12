import type { Address } from '@solana/kit';

export type MarketplaceSource = 'magic-eden' | 'tensor' | null;

export type MarketplaceQuote = {
	floorPriceLamports: bigint | null;
	listingCount: number;
	lastSaleLamports: bigint | null;
	source: MarketplaceSource;
};

export async function fetchMarketplaceQuote(
	_mint: Address
): Promise<MarketplaceQuote | null> {
	return null;
}
