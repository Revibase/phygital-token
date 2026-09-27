import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ platform }) => ({
	cluster: (platform?.env?.SOLANA_CLUSTER ?? 'devnet') as 'mainnet' | 'devnet' | 'testnet' | 'localnet'
});
