import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

import { passkeyEnv, type PasskeyEnv } from './passkey-env';

export { passkeyEnv };

export type ServerEnv = {
	db: D1Database;
	rpcUrl: string;
	sessionSecret: string;
	cluster: string;
	/** Revibase Passkey: the secure-signer origin, and the key that pays its fees. Both or neither. */
	passkey: PasskeyEnv | null;
};

export function getEnv(): ServerEnv {
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) error(500, 'SESSION_SECRET is missing or too short');
	if (!env.SOLANA_RPC_URL) error(500, 'SOLANA_RPC_URL is missing');
	return {
		db: env.DB,
		rpcUrl: env.SOLANA_RPC_URL,
		sessionSecret: secret,
		cluster: env.SOLANA_CLUSTER,
		passkey: passkeyEnv(env.SECURE_SIGNER_ORIGIN, env.FEE_PAYER_KEY)
	};
}

export function getRpc(env: ServerEnv): Rpc<SolanaRpcApi> {
	return createSolanaRpc(env.rpcUrl);
}
