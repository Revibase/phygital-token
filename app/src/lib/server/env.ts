import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

import type { Cluster } from '#lib/client/wallet/wallet';

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

/** Bindings from `wrangler types`. Public values use `NEXT_PUBLIC_` because the browser receives them. */
export async function getEnv(): Promise<Cloudflare.Env> {
	const { env } = (await getCloudflareContext({ async: true })) as unknown as {
		env: Cloudflare.Env;
	};
	if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
		throw new ConfigError('SESSION_SECRET is missing or too short');
	}
	if (!env.NEXT_PUBLIC_SOLANA_RPC_URL)
		throw new ConfigError('NEXT_PUBLIC_SOLANA_RPC_URL is missing');
	if (!env.NEXT_PUBLIC_PRIVY_APP_ID) throw new ConfigError('NEXT_PUBLIC_PRIVY_APP_ID is missing');
	solanaCluster(env);
	return env;
}

export function getRpc(env: Cloudflare.Env): Rpc<SolanaRpcApi> {
	return createSolanaRpc(env.NEXT_PUBLIC_SOLANA_RPC_URL);
}

export function solanaCluster(env: Cloudflare.Env): Cluster {
	const value = env.NEXT_PUBLIC_SOLANA_CLUSTER;
	if (value === 'mainnet' || value === 'devnet' || value === 'testnet' || value === 'localnet')
		return value;
	throw new ConfigError('NEXT_PUBLIC_SOLANA_CLUSTER must be mainnet, devnet, testnet, or localnet');
}
