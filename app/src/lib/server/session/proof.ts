import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';
import type { TokenKind } from '$lib/shared/types';

/**
 * Session proofs for project shortcuts: EdDSA JWTs, verifiable against `/.well-known/session.json`. Signed with
 * a key used for nothing else, so a proof can never pass as one of our cookies.
 */
export const PROOF_TYP = 'revibase-session+jwt';
export const PROOF_TTL_S = 5 * 60;

export type ProofKey = { secretKey: Uint8Array; publicKey: Uint8Array; kid: string };

export type SessionProofClaims = {
	iss: string;
	/** The shortcut's origin, e.g. `https://game.xyz`. */
	aud: string;
	iat: number;
	exp: number;
	jti: string;
	/** Accessory PDA. */
	sub: string;
	mint: string;
	kind: TokenKind;
	/** Owner context, never evidence that a tapper controls its keys. */
	wallet: string | null;
	/** Accessory possession or a wallet-authenticated owner session. */
	authentication: 'accessory' | 'wallet';
};

const keyCache = new Map<string, ProofKey | null>();

/** `SESSION_PROOF_KEY`: a 32-byte Ed25519 seed, base64 or base64url. Unset or malformed means proofs are off. */
export function proofKey(raw: string | null | undefined): ProofKey | null {
	if (!raw) return null;
	if (keyCache.has(raw)) return keyCache.get(raw)!;
	let key: ProofKey | null = null;
	try {
		const secretKey = base64UrlToBytes(raw.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
		if (secretKey.length === 32) {
			const publicKey = ed25519.getPublicKey(secretKey);
			key = { secretKey, publicKey, kid: bytesToBase64Url(sha256(publicKey)).slice(0, 16) };
		}
	} catch {
		key = null;
	}
	keyCache.set(raw, key);
	return key;
}

/** A JWKS, so `jose.createRemoteJWKSet` reads it directly. */
export function proofKeySet(key: ProofKey, issuer: string) {
	return {
		issuer,
		typ: PROOF_TYP,
		keys: [{ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: key.kid, x: bytesToBase64Url(key.publicKey) }]
	};
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const part = (value: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(value)));

export function signSessionProof(key: ProofKey, claims: SessionProofClaims): string {
	const signingInput = `${part({ alg: 'EdDSA', typ: PROOF_TYP, kid: key.kid })}.${part(claims)}`;
	return `${signingInput}.${bytesToBase64Url(ed25519.sign(encoder.encode(signingInput), key.secretKey))}`;
}

/** Reference verifier, matching `jose.jwtVerify`. Replay (`jti`) is the project's to track. */
export function verifySessionProof(
	token: string,
	keys: Array<{ kid: string; publicKey: Uint8Array }>,
	expect: { issuer: string; audience: string; now?: number }
): SessionProofClaims | null {
	try {
		const [h, p, s, extra] = token.split('.');
		if (!h || !p || !s || extra !== undefined) return null;
		const header = JSON.parse(decoder.decode(base64UrlToBytes(h))) as { alg?: string; typ?: string; kid?: string };
		if (header.alg !== 'EdDSA' || header.typ !== PROOF_TYP) return null;
		const key = keys.find((k) => k.kid === header.kid);
		if (!key || !ed25519.verify(base64UrlToBytes(s), encoder.encode(`${h}.${p}`), key.publicKey)) return null;
		const claims = JSON.parse(decoder.decode(base64UrlToBytes(p))) as SessionProofClaims;
		const now = Math.floor((expect.now ?? Date.now()) / 1000);
		if (claims.iss !== expect.issuer || claims.aud !== expect.audience || !(claims.exp > now)) return null;
		return claims;
	} catch {
		return null;
	}
}
