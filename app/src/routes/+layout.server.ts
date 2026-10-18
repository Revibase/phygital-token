import { env } from 'cloudflare:workers';
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

export const load: LayoutServerLoad = () => ({
	cluster: (env.SOLANA_CLUSTER ?? 'devnet') as 'mainnet' | 'devnet' | 'testnet' | 'localnet',
	rpcUrl: env.SOLANA_RPC_URL ?? '',
	payAppOrigin: payAppOrigin(env.PAY_APP_ORIGIN)
});
