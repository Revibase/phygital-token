import { resolveShortcuts } from '../../src/lib/shared/shortcuts.ts';
import type { AccessoryView } from '../../src/lib/shared/types.ts';
export const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
export const MINT = 'So11111111111111111111111111111111111111112';
export const accessory: AccessoryView = {
	pda: MINT,
	identifier: 'simulation',
	tag: 'TEST',
	publicKey: 'simulation',
	kind: 'bearer',
	status: 'linked',
	owner: OWNER,
	isLocked: false,
	mint: MINT,
	lastSignCount: 1,
	canLink: true,
	canRelease: true
};
export const project = {
	externalUrl: 'https://project.example',
	shortcuts: resolveShortcuts(
		{
			shortcuts: [
				{ label: 'Play', uri: 'https://project.example/play', icon: 'gaming', revibase: { launch: 'browser' } },
				{ label: 'Stake NFT', uri: 'https://staking.example/stake', icon: 'stake', revibase: { launch: 'browser' } },
				{ label: 'Visit website', uri: 'https://project.example/about', icon: 'view', revibase: { launch: 'browser' } }
			]
		},
		{ externalUrl: 'https://project.example', tokenId: MINT, collectionId: null, ownerAddress: OWNER }
	)
};
export const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export function walletHoldings(funded: boolean) {
	if (!funded) return { wallet: WALLET, lamports: 0n, tokens: [] };
	return {
		wallet: WALLET,
		lamports: 1_200_000_000n,
		solPriceUsd: 150, // Illustrative preview prices, not live quotes.
		tokens: [
			{ tokenAccount: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T', mint: USDC, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amount: 25_500_000n, decimals: 6, frozen: false, name: 'USD Coin', symbol: 'USDC', icon: '/usdc.svg', priceUsd: 1 },
			{ tokenAccount: 'Ce4vZ9YiTnqBSHqZHs6s3gNa1LANHNFrSrCq3QFamV8J', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amount: 1_000_000_00000n, decimals: 5, frozen: false, name: 'Bonk', symbol: 'Bonk', icon: null, priceUsd: 0.00002 }
			,{ tokenAccount: '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amount: 1n, decimals: 0, frozen: false, name: 'Revi collectible #1', symbol: null, icon: '/icon-512.png', tokenStandard: 'NonFungible' },
			{ tokenAccount: '11111111111111111111111111111111', mint: MINT, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', amount: 1n, decimals: 0, frozen: true, name: 'Programmable collectible', symbol: null, icon: '/icon-512.png', tokenStandard: 'ProgrammableNonFungible' }
		],
		nfts: [
			{ id: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', kind: 'core', name: 'Core collectible', icon: '/icon-512.png', frozen: false },
			{ id: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', kind: 'compressed', name: 'Compressed collectible', icon: '/icon-512.png', frozen: false }
		],
		nftStatus: 'complete'
	};
}
/** `solCap` lamports a day; the default leaves room for a network-fee refill, `1_000_000n` doesn't. */
export function walletPolicy(solCap = 500_000_000n) {
	const day = 86_400n;
	const now = BigInt(Math.floor(Date.now() / 1000));
	return {
		discriminator: new Uint8Array(8),
		phygitalToken: MINT,
		wallet: WALLET,
		solCap: { __option: 'Some', value: { cap: solCap, remaining: solCap - 100_000_000n > 0n ? solCap - 100_000_000n : solCap, lastReset: now - (now % day), windowSeconds: day, maxPerTx: 0n } },
		mintCaps: [{ mint: USDC, cap: { cap: 20_000_000n, remaining: 20_000_000n, lastReset: now - (now % day), windowSeconds: day, maxPerTx: 0n } }],
		allowedOrigins: [],
		programPermissions: []
	};
}
