/**
 * WebAuthn checks for the passkey-wallet backup. One ceremony unlocks PRF in
 * the signer and authorizes the blob fetch here: the restore challenge bytes
 * are the WebAuthn challenge. Replay protection is the short-TTL single-use
 * challenge (no signature counter).
 */
import {
	verifyAuthenticationResponse,
	type AuthenticationResponseJSON
} from '@simplewebauthn/server';
import {
	decodeAttestationObject,
	isoBase64URL,
	parseAuthenticatorData
} from '@simplewebauthn/server/helpers';

import { bytesEqual } from '$lib/shared/encoding';

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * COSE public key + credential id from a registration attestationObject
 * (base64url), after checking its rpIdHash and the UP + AT flags. The PUT
 * binds the credential id to the blob header, so a seed holder can't point a
 * backup at a different passkey.
 */
export async function credentialFromAttestation(attestationObject: string, rpId: string) {
	const decoded = decodeAttestationObject(isoBase64URL.toBuffer(attestationObject));
	const authData = parseAuthenticatorData(decoded.get('authData'));
	if (!authData.credentialPublicKey || !authData.credentialID?.length)
		throw new Error('attestation has no credential');
	if (!bytesEqual(authData.rpIdHash, await sha256(new TextEncoder().encode(rpId))))
		throw new Error('attestation rpIdHash mismatch');
	if (!authData.flags.up || !authData.flags.at) throw new Error('attestation missing UP or AT');
	return { publicKey: authData.credentialPublicKey, credentialId: authData.credentialID };
}

export function isAssertionJSON(v: unknown): v is AuthenticationResponseJSON {
	if (!v || typeof v !== 'object') return false;
	const a = v as Record<string, unknown>;
	const r = a.response as Record<string, unknown> | undefined;
	return (
		typeof a.id === 'string' &&
		typeof a.rawId === 'string' &&
		a.type === 'public-key' &&
		!!r &&
		typeof r.clientDataJSON === 'string' &&
		typeof r.authenticatorData === 'string' &&
		typeof r.signature === 'string'
	);
}

export async function verifyAssertion(opts: {
	assertion: AuthenticationResponseJSON;
	expectedChallenge: string;
	origin: string;
	rpId: string;
	cosePublicKey: Uint8Array;
}): Promise<boolean> {
	try {
		const result = await verifyAuthenticationResponse({
			response: opts.assertion,
			expectedChallenge: opts.expectedChallenge,
			expectedOrigin: opts.origin,
			expectedRPID: opts.rpId,
			credential: {
				id: opts.assertion.id,
				publicKey: new Uint8Array(opts.cosePublicKey) as Uint8Array<ArrayBuffer>,
				counter: 0
			},
			requireUserVerification: true
		});
		return result.verified;
	} catch {
		return false;
	}
}
