/**
 * The fee-payer pool: `SPONSOR_KEYS` (comma-separated base58 64-byte secret
 * keys), loaded once per isolate. Clients pick any key `offered` lists; the
 * ones running low on SOL drop out of that list until they're topped up.
 */
import {
	createKeyPairSignerFromBytes,
	getBase58Encoder,
	signBytes,
	type Address,
	type KeyPairSigner,
	type Rpc,
	type SignatureBytes,
	type SolanaRpcApi
} from '@solana/kit';

import type { SponsorEnv } from '../env';

const BALANCE_TTL_MS = 60_000;

let loaded: { source: string; keys: Promise<Map<Address, KeyPairSigner>> } | null = null;
let balances: { at: number; lamports: Map<Address, bigint> } | null = null;

export function sponsorKeys(env: SponsorEnv): Promise<Map<Address, KeyPairSigner>> {
	if (loaded?.source !== env.keys) {
		const encoder = getBase58Encoder();
		const entries = env.keys
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean);
		loaded = {
			source: env.keys,
			keys: Promise.all(entries.map((k) => createKeyPairSignerFromBytes(encoder.encode(k)))).then(
				(signers) => new Map(signers.map((s) => [s.address, s]))
			)
		};
		balances = null;
	}
	return loaded.keys;
}

/** Pool keys with enough SOL to pay fees (balances cached for a minute). */
export async function offeredFeePayers(
	env: SponsorEnv,
	rpc: Rpc<SolanaRpcApi>,
	now = Date.now()
): Promise<Address[]> {
	const keys = [...(await sponsorKeys(env)).keys()];
	if (keys.length === 0) return [];
	if (!balances || now - balances.at > BALANCE_TTL_MS) {
		const { value } = await rpc
			.getMultipleAccounts(keys, { encoding: 'base64', commitment: 'confirmed' })
			.send();
		balances = {
			at: now,
			lamports: new Map(keys.map((k, i) => [k, BigInt(value[i]?.lamports ?? 0)]))
		};
	}
	return keys.filter((k) => (balances!.lamports.get(k) ?? 0n) >= env.minKeyLamports);
}

export async function signWithPoolKey(
	signer: KeyPairSigner,
	messageBytes: Uint8Array
): Promise<SignatureBytes> {
	return signBytes(signer.keyPair.privateKey, messageBytes);
}

/** Tests only: forget cached keys and balances. */
export function resetSponsorPool() {
	loaded = null;
	balances = null;
}
