import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
	fetchMaybePhygitalToken,
	fetchPhygitalTokenByIdentifier,
	findPhygitalTokenPda,
	type PhygitalToken
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';

export type ResolvedAccessory = { pda: string; account: PhygitalToken };

/**
 * Resolve a chip `identifier` (the dynamic-URL `pk`) to its phygital token.
 *
 * The PDA is seeded by the FIDO passkey, not the identifier, so the first
 * lookup scans with `fetchPhygitalTokenByIdentifier` (getProgramAccounts +
 * memcmp) and caches identifier → PDA. Both are immutable after `initialize`.
 */
export async function resolveAccessoryByIdentifier(
	db: D1Database,
	rpc: Rpc<SolanaRpcApi>,
	identifier: string
): Promise<ResolvedAccessory | null> {
	const cached = await db
		.prepare('SELECT pda FROM revibase_identifier_cache WHERE identifier = ?')
		.bind(identifier)
		.first<{ pda: string }>();

	if (cached) {
		const resolved = await fetchAccessory(rpc, cached.pda);
		// Defensive: never trust the cache over chain state.
		if (resolved && bytesToBase64Url(new Uint8Array(resolved.account.identifier[0])) === identifier) {
			return resolved;
		}
	}

	const account = await fetchPhygitalTokenByIdentifier(rpc, identifier);
	if (!account) return null;
	const pda = String(await findPhygitalTokenPda(account.publicKey));

	await db
		.prepare(
			`INSERT INTO revibase_identifier_cache (identifier, pda, created_at) VALUES (?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET pda = excluded.pda`
		)
		.bind(identifier, pda, Date.now())
		.run();

	return { pda, account };
}

export async function fetchAccessory(rpc: Rpc<SolanaRpcApi>, pda: string): Promise<ResolvedAccessory | null> {
	const maybe = await fetchMaybePhygitalToken(rpc, address(pda), { commitment: 'confirmed' });
	return maybe.exists ? { pda, account: maybe.data } : null;
}
