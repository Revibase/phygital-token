import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { parseSecp256r1Pubkey, type PhygitalToken } from 'phygital-token-sdk';

import { base64UrlToBytes, bytesEqual, bytesToBase64Url } from '$lib/shared/encoding';
import type { LinkErrorCode, TransferPayload } from '$lib/shared/types';
import { accessoryRules, DEFAULT_PUBKEY, TOKEN_KINDS } from '../accessory/view';

type Assertion = TransferPayload['response'];

export type AssertionCheck =
	| { ok: true; assertion: Assertion; signCount: number }
	| { ok: false; code: LinkErrorCode; detail: string };

const FLAG_USER_PRESENT = 0x01;
const CURVE_ORDER = p256.Point.CURVE().n;

function isString(v: unknown): v is string {
	return typeof v === 'string' && v.length > 0 && v.length < 4096;
}

/** Validate the shape of an untrusted `AuthenticationResponseJSON`. */
export function parseAssertion(input: unknown): Assertion | null {
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
		authenticatorAttachment: typeof r.authenticatorAttachment === 'string' ? r.authenticatorAttachment : undefined,
		response: {
			clientDataJSON: inner.clientDataJSON,
			authenticatorData: inner.authenticatorData,
			signature: inner.signature,
			userHandle: isString(inner.userHandle) ? inner.userHandle : undefined
		}
	};
}

function compactLowS(signature: Uint8Array): Uint8Array {
	const sig =
		signature.length === 64 ? p256.Signature.fromBytes(signature, 'compact') : p256.Signature.fromBytes(signature, 'der');
	const low = sig.hasHighS() ? new p256.Signature(sig.r, CURVE_ORDER - sig.s) : sig;
	return low.toBytes('compact');
}

export type WebAuthnCheck =
	| { ok: true; assertion: Assertion; signCount: number; publicKey: string }
	| { ok: false; code: LinkErrorCode; detail: string };

type AssertionContext =
	| {
			ok: true;
			assertion: Assertion;
			challenge: unknown;
			clientDataBytes: Uint8Array;
			authData: Uint8Array;
			signature: Uint8Array;
			signCount: number;
			credentialKey: Uint8Array;
			publicKey: string;
		}
	| { ok: false; code: LinkErrorCode; detail: string };

/**
 * Everything about an assertion except its challenge and signature: shape,
 * ceremony type, origin, rpId hash, user presence, and a passkey-shaped
 * credential id. These are exactly the checks the SDK's `verifyResponse`
 * leaves out, so a path that verifies with the SDK must run this too.
 */
export function checkAssertionContext(input: { response: unknown; rpId: string; origin: string }): AssertionContext {
	const assertion = parseAssertion(input.response);
	if (!assertion) return { ok: false, code: 'tap_rejected', detail: 'malformed assertion' };

	let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
	let clientDataBytes: Uint8Array;
	let authData: Uint8Array;
	let signature: Uint8Array;
	try {
		clientDataBytes = base64UrlToBytes(assertion.response.clientDataJSON);
		clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
		authData = base64UrlToBytes(assertion.response.authenticatorData);
		signature = base64UrlToBytes(assertion.response.signature);
	} catch {
		return { ok: false, code: 'tap_rejected', detail: 'undecodable assertion' };
	}

	if (clientData.type !== 'webauthn.get') return { ok: false, code: 'tap_rejected', detail: 'wrong ceremony type' };
	if (clientData.origin !== input.origin || clientData.crossOrigin === true) {
		return { ok: false, code: 'tap_rejected', detail: 'origin mismatch' };
	}
	if (authData.length < 37) return { ok: false, code: 'tap_rejected', detail: 'short authenticatorData' };
	if (!bytesEqual(authData.subarray(0, 32), sha256(new TextEncoder().encode(input.rpId)))) {
		return { ok: false, code: 'tap_rejected', detail: 'rpId mismatch' };
	}
	if ((authData[32] & FLAG_USER_PRESENT) === 0) {
		return { ok: false, code: 'tap_rejected', detail: 'user presence not set' };
	}
	const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);

	let credentialKey: Uint8Array;
	try {
		credentialKey = new Uint8Array(parseSecp256r1Pubkey(assertion.id)[0]);
	} catch {
		return { ok: false, code: 'tap_rejected', detail: 'credential id is not a passkey' };
	}

	return {
		ok: true,
		assertion,
		challenge: clientData.challenge,
		clientDataBytes,
		authData,
		signature,
		signCount,
		credentialKey,
		publicKey: bytesToBase64Url(credentialKey)
	};
}

/**
 * Verify a WebAuthn assertion from the accessory for OUR relying party:
 * {@link checkAssertionContext}, the exact challenge, and the P-256 signature
 * over `authenticatorData || SHA-256(clientDataJSON)`.
 *
 * The program never checks rpId/origin, and the SDK's `verifyResponse` checks
 * only challenge + signature — so every server path goes through the context check.
 * `expectedPublicKey` pins the accessory when we already know which one it is.
 */
export function verifyWebAuthnAssertion(input: {
	response: unknown;
	expectedChallenge: string;
	rpId: string;
	origin: string;
	expectedPublicKey?: string;
}): WebAuthnCheck {
	const ctx = checkAssertionContext(input);
	if (!ctx.ok) return ctx;
	if (ctx.challenge !== input.expectedChallenge) {
		return { ok: false, code: 'tap_rejected', detail: 'challenge mismatch' };
	}
	if (input.expectedPublicKey !== undefined && ctx.publicKey !== input.expectedPublicKey) {
		return { ok: false, code: 'different_accessory', detail: 'assertion from a different accessory' };
	}

	const signed = new Uint8Array(ctx.authData.length + 32);
	signed.set(ctx.authData, 0);
	signed.set(sha256(ctx.clientDataBytes), ctx.authData.length);
	let valid = false;
	try {
		valid = p256.verify(compactLowS(ctx.signature), signed, ctx.credentialKey);
	} catch {
		valid = false;
	}
	if (!valid) return { ok: false, code: 'tap_rejected', detail: 'bad signature' };

	return { ok: true, assertion: ctx.assertion, signCount: ctx.signCount, publicKey: ctx.publicKey };
}

/**
 * Server-side gate before a transfer assertion is taken into custody:
 * {@link verifyWebAuthnAssertion} pinned to the session's accessory, then the
 * product rules for its token type and the program's signCount rule.
 */
export function checkTransferAssertion(input: {
	response: unknown;
	expectedChallenge: string;
	expectedPublicKey: string;
	account: PhygitalToken;
	rpId: string;
	origin: string;
}): AssertionCheck {
	const verified = verifyWebAuthnAssertion(input);
	if (!verified.ok) return verified;

	const kind = TOKEN_KINDS[input.account.tokenType] ?? 'unknown';
	const linked = input.account.linkedWallet === DEFAULT_PUBKEY ? null : String(input.account.linkedWallet);
	if (kind === 'permanent') return { ok: false, code: 'accessory_permanent', detail: 'permanent token' };
	if (!accessoryRules(kind, linked, input.account.isLocked !== 0).canLink) {
		return { ok: false, code: 'accessory_locked', detail: `${kind} token cannot be linked in its current state` };
	}
	if (verified.signCount <= input.account.lastSignCount) {
		return { ok: false, code: 'already_used', detail: 'stale signCount' };
	}

	return { ok: true, assertion: verified.assertion, signCount: verified.signCount };
}
