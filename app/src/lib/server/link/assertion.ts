import { verifyResponse, type AuthenticationResponseJSON } from 'phygital-token-sdk';

import type { LinkErrorCode, TransferPayload } from '$lib/shared/types';

type Assertion = TransferPayload['response'];

export type AssertionCheck =
	{ ok: true; assertion: Assertion } | { ok: false; code: LinkErrorCode; detail: string };

function isString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length < 4096;
}

export function parseAssertion(input: unknown): Assertion | null {
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
	return {
		id: r.id,
		rawId: r.rawId,
		type: 'public-key',
		clientExtensionResults: {},
		authenticatorAttachment:
			typeof r.authenticatorAttachment === 'string' ? r.authenticatorAttachment : undefined,
		response: {
			clientDataJSON: inner.clientDataJSON,
			authenticatorData: inner.authenticatorData,
			signature: inner.signature,
			userHandle: isString(inner.userHandle) ? inner.userHandle : undefined
		}
	};
}

/**
 * Verify a fresh accessory tap over `expectedChallenge` (base64url). The SDK's
 * `verifyResponse` checks the challenge, the origin the tap was made on, the
 * rpId, user presence and the P-256 signature; `signCount`, the token's passkey
 * and its lock state are enforced on-chain.
 */
export async function checkTransferAssertion(input: {
	response: unknown;
	expectedChallenge: string;
	expectedOrigin: string;
	expectedRpId: string;
}): Promise<AssertionCheck> {
	const assertion = parseAssertion(input.response);
	if (!assertion) return { ok: false, code: 'tap_rejected', detail: 'malformed assertion' };

	try {
		const { isVerified } = await verifyResponse({
			expectedChallenge: input.expectedChallenge,
			expectedOrigin: input.expectedOrigin,
			expectedRpId: input.expectedRpId,
			response: assertion as AuthenticationResponseJSON
		});
		if (!isVerified) throw new Error();
	} catch {
		return { ok: false, code: 'tap_rejected', detail: 'assertion rejected' };
	}

	return { ok: true, assertion };
}
