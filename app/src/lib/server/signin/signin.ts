import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { fetchMaybePhygitalToken, findPhygitalTokenPda } from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import type { AccessoryView } from '$lib/shared/types';
import { toAccessoryView } from '../accessory/view';
import { verifyWebAuthnAssertion } from '../link/assertion';

/** A sign-in challenge is only good for this long, and only once. */
export const SIGNIN_CHALLENGE_TTL_MS = 2 * 60 * 1000;

const random = (n: number) => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * Issue a single-use challenge. The `message` is what the client passes to the
 * SDK's `startAuthentication(message, rpc)`, which signs its UTF-8 bytes.
 */
export async function issueSignInChallenge(db: D1Database, now = Date.now()) {
	const id = random(16);
	const message = `phygital-signin:${random(32)}`;
	await db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(now - 60_000).run();
	await db
		.prepare('INSERT INTO auth_challenges (id, message, expires_at) VALUES (?, ?, ?)')
		.bind(id, message, now + SIGNIN_CHALLENGE_TTL_MS)
		.run();
	return { challengeId: id, message };
}

export type SignInResult =
	| { ok: true; accessory: AccessoryView; wallet: string | null }
	| { ok: false; status: number; error: string };

/**
 * "Sign in with your accessory": the tap proves the accessory is present
 * right now; its on-chain record says which wallet it stands for.
 */
export async function verifySignIn(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi>; rpId: string; origin: string },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<SignInResult> {
	if (typeof input.challengeId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(input.challengeId)) {
		return { ok: false, status: 400, error: 'Missing challenge.' };
	}
	const row = await deps.db
		.prepare('SELECT message FROM auth_challenges WHERE id = ? AND used_at IS NULL AND expires_at > ?')
		.bind(input.challengeId, now)
		.first<{ message: string }>();
	if (!row) return { ok: false, status: 409, error: 'This sign-in expired. Try again.' };

	// Consume first (compare-and-set) so a response can never be replayed, valid or not.
	const consumed = await deps.db
		.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL')
		.bind(now, input.challengeId)
		.run();
	if ((consumed.meta?.changes ?? 0) === 0) return { ok: false, status: 409, error: 'This sign-in expired. Try again.' };

	const verified = verifyWebAuthnAssertion({
		response: input.response,
		expectedChallenge: bytesToBase64Url(new TextEncoder().encode(row.message)),
		rpId: deps.rpId,
		origin: deps.origin
	});
	if (!verified.ok) return { ok: false, status: 401, error: 'We couldn’t verify that tap.' };

	const pda = await findPhygitalTokenPda(verified.publicKey);
	const token = await fetchMaybePhygitalToken(deps.rpc, address(String(pda)), { commitment: 'confirmed' });
	if (!token.exists) return { ok: false, status: 404, error: 'This accessory isn’t registered.' };
	const accessory = toAccessoryView(String(pda), token.data);
	return { ok: true, accessory, wallet: accessory.linkedWallet };
}
