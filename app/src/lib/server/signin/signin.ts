import { address, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
	fetchMaybePhygitalToken,
	findPhygitalTokenPda,
	verifyResponse,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

import type { AccessoryView, TokenKind } from '$lib/shared/types';
import { toAccessoryView } from '../accessory/view';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';
import { parseAssertion } from '../link/assertion';

export const SIGNIN_NAMESPACE = 'revibase-signin';

export const issueSignInChallenge = (db: D1Database, now = Date.now()) =>
	issueChallenge(db, SIGNIN_NAMESPACE, now);

export type SignInResult =
	| { ok: true; accessory: AccessoryView; wallet: string | null }
	| { ok: false; status: number; error: string; code: 'bad_request' | 'expired' | 'tap_rejected' | 'unknown_accessory' | 'not_a_key' };

const SIGN_IN_KINDS: ReadonlySet<TokenKind> = new Set(['controlled', 'permanent']);

export async function verifySignIn(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi>; rpId: string; origin: string },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<SignInResult> {
	if (!isChallengeId(input.challengeId)) {
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	}
	const expectedMessage = await consumeChallenge(deps.db, SIGNIN_NAMESPACE, input.challengeId, now);
	if (!expectedMessage) return { ok: false, status: 409, code: 'expired', error: 'This sign-in expired. Try again.' };

	const assertion = parseAssertion(input.response);
	if (!assertion) return { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' };

	let secp256r1PublicKey: string;
	try {
		const result = verifyResponse({
			expectedMessage,
			response: assertion as AuthenticationResponseJSON
		});
		if (!result.isVerified) {
			return { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' };
		}
		secp256r1PublicKey = result.secp256r1PublicKey;
	} catch {
		return { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' };
	}

	const pda = await findPhygitalTokenPda(secp256r1PublicKey);
	const token = await fetchMaybePhygitalToken(deps.rpc, address(String(pda)), { commitment: 'confirmed' });
	if (!token.exists) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };
	const accessory = toAccessoryView(String(pda), token.data);
	if (!SIGN_IN_KINDS.has(accessory.kind)) {
		return { ok: false, status: 403, code: 'not_a_key', error: 'This accessory is a tradable collectible, so it can’t be used to sign in.' };
	}
	return { ok: true, accessory, wallet: accessory.linkedWallet };
}
