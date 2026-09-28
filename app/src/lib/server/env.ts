import { error } from '@sveltejs/kit';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

export type ServerEnv = {
	/**
	 * The shared `phygital-token` D1 database: `tap_counters` and `auth_challenges`
	 * (schema owned by phygital-wallet) plus this app's `revibase_*` tables.
	 */
	db: D1Database;
	/** Helius RPC: standard Solana methods plus DAS (`getAsset`, `getAssetsByOwner`, …). */
	rpcUrl: string;
	sessionSecret: string;
	rpId: string;
	origin: string;
	cluster: string;
};

export function getEnv(platform: App.Platform | undefined): ServerEnv {
	const env = platform?.env;
	if (!env) error(500, 'Platform bindings unavailable');
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) error(500, 'SESSION_SECRET is missing or too short');
	if (!env.SOLANA_RPC_URL) error(500, 'SOLANA_RPC_URL is missing');
	return {
		db: env.DB,
		rpcUrl: env.SOLANA_RPC_URL,
		sessionSecret: secret,
		rpId: env.RP_ID,
		origin: env.ORIGIN,
		cluster: env.SOLANA_CLUSTER
	};
}

export function getRpc(env: ServerEnv): Rpc<SolanaRpcApi> {
	return createSolanaRpc(env.rpcUrl);
}
