import { error } from '@sveltejs/kit';
import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

export type ServerEnv = {
	db: D1Database;
	rpcUrl: string;
	sessionSecret: string;
	rpId: string;
	/** The passkey-wallet iframe's origin (frame-src, backup CORS, WebAuthn origin). */
	signerOrigin: string;
	cluster: string;
	sponsor: SponsorEnv;
};

/** The fee service (`/api/sponsor`): a pool of fee-payer keys and each accessory's prepaid network fees. */
export type SponsorEnv = {
	/** Comma-separated base58 64-byte secret keys; empty turns the service off. */
	keys: string;
	prepaidLamports: bigint;
	maxComputeUnitLimit: number;
	maxComputeUnitPrice: bigint;
	/** Keys below this balance are no longer offered. */
	minKeyLamports: bigint;
};

const bigintVar = (value: string | undefined, fallback: bigint) =>
	value && /^\d+$/.test(value) ? BigInt(value) : fallback;

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
		signerOrigin: env.SECURE_SIGNER_ORIGIN,
		cluster: env.SOLANA_CLUSTER,
		sponsor: {
			keys: env.SPONSOR_KEYS ?? '',
			prepaidLamports: bigintVar(env.SPONSOR_PREPAID_LAMPORTS, 5_000_000n),
			maxComputeUnitLimit: Number(bigintVar(env.SPONSOR_MAX_CU_LIMIT, 400_000n)),
			maxComputeUnitPrice: bigintVar(env.SPONSOR_MAX_CU_PRICE, 100_000n),
			minKeyLamports: bigintVar(env.SPONSOR_MIN_KEY_LAMPORTS, 50_000_000n)
		}
	};
}

export function getRpc(env: ServerEnv): Rpc<SolanaRpcApi> {
	return createSolanaRpc(env.rpcUrl);
}
