import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { fetchMaybePhygitalToken, findPhygitalTokenPda } from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import type { AccessoryView, TokenKind } from '$lib/shared/types';
import { toAccessoryView } from '../accessory/view';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';
import { verifyWebAuthnAssertion } from '../link/assertion';

/** Namespace for sign-in rows in the shared `auth_challenges` table. */
export const SIGNIN_NAMESPACE = 'revibase-signin';

/** Issue a single-use sign-in challenge (see `challenges.ts`). */
export const issueSignInChallenge = (db: D1Database, now = Date.now()) => issueChallenge(db, SIGNIN_NAMESPACE, now);

export type SignInResult =
	| { ok: true; accessory: AccessoryView; wallet: string | null }
	| { ok: false; status: number; error: string; code: 'bad_request' | 'expired' | 'tap_rejected' | 'unknown_accessory' | 'not_a_key' };

/**
 * Only personal keys sign in. A Bearer accessory is a tradable collectible:
 * whoever holds it can claim it, so it must never stand in for a wallet.
 */
const SIGN_IN_KINDS: ReadonlySet<TokenKind> = new Set(['controlled', 'permanent']);

/**
 * "Sign in with your accessory": the tap proves the accessory is present
 * right now; its on-chain record says which wallet it stands for.
 */
export async function verifySignIn(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi>; rpId: string; origin: string },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<SignInResult> {
	if (!isChallengeId(input.challengeId)) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	}
	const message = await consumeChallenge(deps.db, SIGNIN_NAMESPACE, input.challengeId, now);
	if (!message) return { ok: false, status: 409, code: 'expired', error: 'This sign-in expired. Try again.' };

	const verified = verifyWebAuthnAssertion({
		response: input.response,
		expectedChallenge: bytesToBase64Url(new TextEncoder().encode(message)),
		rpId: deps.rpId,
		origin: deps.origin
	});
	if (!verified.ok) return { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' };

	const pda = await findPhygitalTokenPda(verified.publicKey);
	const token = await fetchMaybePhygitalToken(deps.rpc, address(String(pda)), { commitment: 'confirmed' });
	if (!token.exists) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };
	const accessory = toAccessoryView(String(pda), token.data);
	if (!SIGN_IN_KINDS.has(accessory.kind)) {
		return { ok: false, status: 403, code: 'not_a_key', error: 'This accessory is a tradable collectible, so it can’t be used to sign in.' };
	}
	return { ok: true, accessory, wallet: accessory.linkedWallet };
}
