import type { LayoutServerLoad } from './$types';

function payAppOrigin(raw: string | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
		return url.origin;
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = ({ platform }) => ({
	cluster: (platform?.env?.SOLANA_CLUSTER ?? 'devnet') as
		'mainnet' | 'devnet' | 'testnet' | 'localnet',
	rpcUrl: platform?.env?.SOLANA_RPC_URL ?? '',
	payAppOrigin: payAppOrigin(platform?.env?.PAY_APP_ORIGIN)
});
