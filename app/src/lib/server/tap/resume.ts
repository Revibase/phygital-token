import type { Rpc, SolanaRpcApi } from '@solana/kit';
import {
	findPhygitalTokenPda,
	verifyResponse,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import { fetchAccessory } from '../accessory/resolve';
import { consumeChallenge, isChallengeId, issueChallenge } from '../challenges';
import { parseAssertion } from '../link/assertion';

export const RESUME_NAMESPACE = 'revibase-resume';

export const issueResumeChallenge = (db: D1Database, now = Date.now()) =>
	issueChallenge(db, RESUME_NAMESPACE, now);

export type ResumeResult =
	| { ok: true; pda: string; identifier: string }
	| { ok: false; status: number; code: 'bad_request' | 'too_slow' | 'tap_rejected' | 'unknown_accessory'; error: string };

export async function verifyResume(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi> },
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
		const result = verifyResponse({
			expectedMessage,
			response: assertion as AuthenticationResponseJSON
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
