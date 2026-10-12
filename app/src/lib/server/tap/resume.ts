import type { Rpc, SolanaRpcApi } from '@solana/kit';
import {
	findPhygitalTokenPda,
	verifyResponse,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import { fetchAccessory } from '../accessory/resolve';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';

function isString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length < 4096;
}

/** The tap response the browser posted, or null if it isn't one. */
function parseAssertion(input: unknown): AuthenticationResponseJSON | null {
	if (!input || typeof input !== 'object') return null;
	const r = input as Record<string, unknown>;
	const inner = r.response as Record<string, unknown> | undefined;
	if (!isString(r.id) || !isString(r.rawId) || r.type !== 'public-key' || !inner) return null;
	if (!isString(inner.clientDataJSON) || !isString(inner.authenticatorData) || !isString(inner.signature)) return null;
	return {
		id: r.id,
		rawId: r.rawId,
		type: 'public-key',
		clientExtensionResults: {},
		response: {
			clientDataJSON: inner.clientDataJSON,
			authenticatorData: inner.authenticatorData,
			signature: inner.signature,
			userHandle: isString(inner.userHandle) ? inner.userHandle : undefined
		}
	};
}

export const RESUME_NAMESPACE = 'revibase-resume';

export const issueResumeChallenge = (db: D1Database, now = Date.now()) =>
	issueChallenge(db, RESUME_NAMESPACE, now);

export type ResumeResult =
	| { ok: true; pda: string; identifier: string }
	| { ok: false; status: number; code: 'bad_request' | 'too_slow' | 'tap_rejected' | 'unknown_accessory'; error: string };

export async function verifyResume(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi>; origin: string },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<ResumeResult> {
	if (!isChallengeId(input.challengeId)) return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	const expectedMessage = await consumeChallenge(deps.db, RESUME_NAMESPACE, input.challengeId, now);
	if (!expectedMessage) return { ok: false, status: 409, code: 'too_slow', error: 'That took too long. Try again.' };

	const rejected = { ok: false, status: 401, code: 'tap_rejected', error: 'We couldn’t verify that tap.' } as const;
	const assertion = parseAssertion(input.response);
	if (!assertion) return rejected;

	let secp256r1PublicKey: string;
	try {
		const result = await verifyResponse({
			expectedMessage,
			expectedOrigin: deps.origin,
			response: assertion
		});
		if (!result.isVerified) return rejected;
		secp256r1PublicKey = result.secp256r1PublicKey;
	} catch {
		return rejected;
	}

	const resolved = await fetchAccessory(deps.rpc, String(await findPhygitalTokenPda(secp256r1PublicKey)));
	if (!resolved) return { ok: false, status: 404, code: 'unknown_accessory', error: 'This accessory isn’t registered.' };
	return { ok: true, pda: resolved.pda, identifier: bytesToBase64Url(new Uint8Array(resolved.account.identifier[0])) };
}
