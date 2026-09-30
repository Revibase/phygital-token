import { error } from '@sveltejs/kit';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

export type ServerEnv = {
	db: D1Database;
	rpcUrl: string;
	sessionSecret: string;
	/** Ed25519 seed for session proofs sent to project shortcuts; unset turns proofs off. */
	sessionProofKey: string | null;
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
		sessionProofKey: env.SESSION_PROOF_KEY ?? null,
		rpId: env.RP_ID,
		origin: env.ORIGIN,
		cluster: env.SOLANA_CLUSTER
	};
}

export function getRpc(env: ServerEnv): Rpc<SolanaRpcApi> {
	return createSolanaRpc(env.rpcUrl);
}
