import type { Rpc, SolanaRpcApi } from '@solana/kit';
import {
	findPhygitalTokenPda,
	verifyResponse,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '#lib/shared/encoding.ts';
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
	if (
		!isString(inner.clientDataJSON) ||
		!isString(inner.authenticatorData) ||
		!isString(inner.signature)
	)
		return null;
	const ext = r.clientExtensionResults as Record<string, unknown> | undefined;
	const largeBlob = ext?.largeBlob as Record<string, unknown> | undefined;
	const blob = largeBlob?.blob;
	return {
		id: r.id,
		rawId: r.rawId,
		type: 'public-key',
		clientExtensionResults: {
			...(isString(blob) ? { largeBlob: { blob } } : {})
		},
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
	| {
			ok: false;
			status: number;
			code: 'bad_request' | 'too_slow' | 'tap_rejected' | 'unknown_accessory';
			error: string;
	  };

export async function verifyResume(
	deps: { db: D1Database; rpc: Rpc<SolanaRpcApi> },
	input: { challengeId: unknown; response: unknown },
	now = Date.now()
): Promise<ResumeResult> {
	if (!isChallengeId(input.challengeId))
		return { ok: false, status: 400, code: 'bad_request', error: 'Missing challenge.' };
	const expectedMessage = await consumeChallenge(deps.db, RESUME_NAMESPACE, input.challengeId, now);
	if (!expectedMessage)
		return { ok: false, status: 409, code: 'too_slow', error: 'That took too long. Try again.' };

	const rejected = {
		ok: false,
		status: 401,
		code: 'tap_rejected',
		error: 'We couldn’t verify that tap.'
	} as const;
	const assertion = parseAssertion(input.response);
	if (!assertion) return rejected;

	let publicKey: Uint8Array;
	try {
		publicKey = verifyResponse(assertion, expectedMessage).publicKey;
	} catch {
		return rejected;
	}

	const resolved = await fetchAccessory(deps.rpc, String(await findPhygitalTokenPda(publicKey)));
	if (!resolved)
		return {
			ok: false,
			status: 404,
			code: 'unknown_accessory',
			error: 'This accessory isn’t registered.'
		};
	return {
		ok: true,
		pda: resolved.pda,
		identifier: bytesToBase64Url(new Uint8Array(resolved.account.identifier[0]))
	};
}
