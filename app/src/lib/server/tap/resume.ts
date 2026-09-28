import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { findPhygitalTokenPda, verifyResponse, type VerifyResponseOptions } from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import { fetchAccessory } from '../accessory/resolve';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';
import { checkAssertionContext } from '../link/assertion';

/** Namespace for resume rows in the shared `auth_challenges` table. */
export const RESUME_NAMESPACE = 'revibase-resume';

/** Issue a single-use challenge for resuming an accessory session. */
export const issueResumeChallenge = (db: D1Database, now = Date.now()) => issueChallenge(db, RESUME_NAMESPACE, now);

export type ResumeResult =
	| { ok: true; pda: string; identifier: string }
	| { ok: false; status: number; code: 'bad_request' | 'too_slow' | 'tap_rejected' | 'unknown_accessory'; error: string };

/**
 * Resume an expired accessory session with a FIDO tap instead of a new NFC
 * read: the SDK's `startAuthentication` on the client, `verifyResponse` here.
 *
 * A fresh assertion over a single-use server challenge proves the accessory is
 * present now — more than an NFC tap URL does — so it may reissue the same
 * read-and-start-a-ceremony session. `verifyResponse` checks only the challenge
 * and signature, so `checkAssertionContext` adds origin, rpId and user presence:
 * without them, a tap harvested by another site could be redeemed here.
 */
export async function verifyResume(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi>; rpId: string; origin: string },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<ResumeResult> {
	if (!isChallengeId(input.challengeId)) return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	const message = await consumeChallenge(deps.db, RESUME_NAMESPACE, input.challengeId, now);
	if (!message) return { ok: false, status: 409, code: 'too_slow', error: 'That took too long. Try again.' };

	const rejected = { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' } as const;
	const ctx = checkAssertionContext({ response: input.response, rpId: deps.rpId, origin: deps.origin });
	if (!ctx.ok) return rejected;
	try {
		const { isVerified } = verifyResponse({ expectedMessage: message, response: ctx.assertion as VerifyResponseOptions['response'] });
		if (!isVerified) return rejected;
	} catch {
		return rejected; // challenge mismatch
	}

	// The PDA is seeded by the passkey. Use the canonical key the context check decoded.
	const resolved = await fetchAccessory(deps.rpc, String(await findPhygitalTokenPda(ctx.publicKey)));
	if (!resolved) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };
	return { ok: true, pda: resolved.pda, identifier: bytesToBase64Url(new Uint8Array(resolved.account.identifier[0])) };
}
