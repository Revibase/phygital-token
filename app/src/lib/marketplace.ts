import type { Address } from '@solana/kit';

export type MarketplaceQuote = {
	floorPrice: bigint | null;
	listingCount: number;
};

export async function fetchMarketplaceQuote(
	_mint: Address
): Promise<MarketplaceQuote | null> {
	return null;
}
