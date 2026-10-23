import { generateKeyPairSigner, type Address } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { describe, expect, it } from 'vitest';

import { arrangeTokens, TOKEN_PREVIEW, type TokenHolding } from '#lib/shared/wallet-holdings.ts';

async function token(overrides: Partial<TokenHolding> & { mint?: Address }): Promise<TokenHolding> {
	return {
		tokenAccount: (await generateKeyPairSigner()).address,
		mint: overrides.mint ?? (await generateKeyPairSigner()).address,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
		amount: 1_000_000n,
		decimals: 6,
		frozen: false,
		name: null,
		symbol: null,
		icon: null,
		priceUsd: null,
		...overrides
	};
}

describe('arrangeTokens', () => {
	it('puts priced tokens first by value, then the rest by symbol', async () => {
		const dust = await token({ symbol: 'DUST', amount: 1n, decimals: 0, priceUsd: 1 });
		const usdc = await token({ symbol: 'USDC', amount: 50_000_000n, decimals: 6, priceUsd: 1 });
		const unnamed = await token({ symbol: 'ZZZ' });
		const bonk = await token({ symbol: 'BONK', amount: 2n, decimals: 0, priceUsd: 10 });
		const ordered = arrangeTokens([dust, unnamed, usdc, bonk]);
		expect(ordered.map((item) => item.symbol)).toEqual(['USDC', 'BONK', 'DUST', 'ZZZ']);
		expect(ordered.slice(0, TOKEN_PREVIEW)).toHaveLength(4);
	});

	it('keeps a priced token ahead of an unpriced one with the same symbol order', async () => {
		const priced = await token({ symbol: 'B', priceUsd: 2, amount: 1n, decimals: 0 });
		const plain = await token({ symbol: 'A' });
		expect(arrangeTokens([plain, priced]).map((item) => item.symbol)).toEqual(['B', 'A']);
	});
});
