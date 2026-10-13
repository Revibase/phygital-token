/**
 * Passkey-wallet backup for the secure-signer (`/api/signer/*`).
 *
 * The worker stores RSS1 ciphertext keyed by sha256(credential id) and never
 * sees a key. Restore requires a WebAuthn assertion from that credential over
 * a single-use challenge; a backup PUT requires an ed25519 proof from the
 * wallet key over another one, plus the registration attestation on create.
 * No cookies: each call authenticates itself.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { getAddressDecoder } from '@solana/kit';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
	challengeMessage,
	decodeBase64UrlCapped,
	MAX_BLOB_BYTES,
	MAX_CREDENTIAL_ID_BYTES,
	parseWalletBlobHeader,
	PUT_CHALLENGE_PREFIX,
	type ChallengeResponse,
	type WalletBlobPutResponse,
	type WalletBlobRestoreResponse
} from 'secure-signer/shared';

import { base64UrlToBytes, bytesEqual, bytesToBase64Url } from '$lib/shared/encoding';
import { consumeChallenge, issueChallenge, isChallengeId } from '../challenges';
import { getEnv, type ServerEnv } from '../env';
import { credentialFromAttestation, isAssertionJSON, verifyAssertion } from './webauthn';

const BACKUP = 'revibase-signer:backup';
const RESTORE = 'revibase-signer:restore';

export class SignerApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

const bad = (code: string, message: string) => new SignerApiError(400, code, message);
const randomChallenge = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Row = { public_key: string; encrypted_blob: string; webauthn_public_key: string };

/**
 * Backups that may share one credential id. A real passkey has one; extra rows
 * only come from someone registering a self-made attestation under its id, which
 * can't block the owner (rows are keyed by credential id and passkey key), but
 * mustn't grow without bound either.
 */
const MAX_BACKUPS_PER_CREDENTIAL = 3;

export async function issueBackupChallenge(db: D1Database): Promise<ChallengeResponse> {
	const { challengeId, message } = await issueChallenge(db, BACKUP, Date.now(), randomChallenge);
	return { challengeId, challenge: message };
}

export async function issueRestoreChallenge(db: D1Database): Promise<ChallengeResponse> {
	const { challengeId, message } = await issueChallenge(db, RESTORE, Date.now(), randomChallenge);
	return { challengeId, challenge: message };
}

export async function restoreBlob(
	env: { db: D1Database; rpId: string; signerOrigin: string },
	body: Record<string, unknown>
): Promise<WalletBlobRestoreResponse> {
	const { challengeId, assertion } = body;
	if (!isChallengeId(challengeId)) throw bad('challenge_required', 'challengeId is required');
	if (!isAssertionJSON(assertion))
		throw bad('invalid_assertion', 'assertion must be a WebAuthn AuthenticationResponseJSON');
	const challenge = await consumeChallenge(env.db, RESTORE, challengeId);
	if (!challenge)
		throw new SignerApiError(
			409,
			'challenge_invalid',
			'Restore challenge expired or invalid. Try again.'
		);

	let hash: string;
	try {
		hash = await sha256Hex(decodeBase64UrlCapped(assertion.rawId, MAX_CREDENTIAL_ID_BYTES));
	} catch {
		throw bad('invalid_assertion', 'Invalid assertion rawId');
	}
	const { results: rows } = await env.db
		.prepare(
			'SELECT public_key, encrypted_blob, webauthn_public_key FROM revibase_signer_wallets WHERE credential_id_hash = ? LIMIT ?'
		)
		.bind(hash, MAX_BACKUPS_PER_CREDENTIAL)
		.all<Row>();
	if (!rows.length) throw new SignerApiError(404, 'not_found', 'No wallet backup for this passkey');

	// The backup is the one whose registered key signed this assertion.
	for (const row of rows) {
		const verified = await verifyAssertion({
			assertion,
			expectedChallenge: challenge,
			origin: env.signerOrigin,
			rpId: env.rpId,
			cosePublicKey: base64UrlToBytes(row.webauthn_public_key)
		});
		if (verified) return { encryptedWalletBlob: row.encrypted_blob, publicKey: row.public_key };
	}
	throw new SignerApiError(401, 'webauthn_invalid', 'WebAuthn assertion verification failed');
}

export async function putBlob(
	env: { db: D1Database; rpId: string },
	body: Record<string, unknown>
): Promise<WalletBlobPutResponse> {
	const { challengeId, signature, encryptedWalletBlob, publicKey, webauthnAttestationObject } =
		body;
	if (!isChallengeId(challengeId) || typeof signature !== 'string' || !signature) {
		throw new SignerApiError(401, 'proof_required', 'challengeId and signature are required');
	}
	if (typeof encryptedWalletBlob !== 'string' || !encryptedWalletBlob)
		throw bad('invalid_wallet_blob', 'encryptedWalletBlob is required');
	if (typeof publicKey !== 'string') throw bad('invalid_public_key', 'publicKey is required');
	if (webauthnAttestationObject !== undefined && typeof webauthnAttestationObject !== 'string') {
		throw bad('invalid_attestation', 'webauthnAttestationObject must be a string');
	}

	let header;
	try {
		header = parseWalletBlobHeader(decodeBase64UrlCapped(encryptedWalletBlob, MAX_BLOB_BYTES));
	} catch {
		throw bad('invalid_wallet_blob', 'Invalid encrypted wallet blob');
	}
	if (getAddressDecoder().decode(header.publicKey) !== publicKey)
		throw bad('wallet_mismatch', 'publicKey does not match the wallet blob');

	let attested: { publicKey: Uint8Array; credentialId: Uint8Array } | null = null;
	if (webauthnAttestationObject) {
		try {
			attested = await credentialFromAttestation(webauthnAttestationObject, env.rpId);
		} catch {
			throw bad('invalid_attestation', 'Invalid WebAuthn attestation');
		}
		if (!bytesEqual(attested.credentialId, header.credentialId)) {
			throw bad(
				'webauthn_credential_mismatch',
				'WebAuthn credential does not match the wallet blob'
			);
		}
	}

	const challenge = await consumeChallenge(env.db, BACKUP, challengeId);
	if (!challenge)
		throw new SignerApiError(409, 'challenge_invalid', 'This backup request expired. Try again.');
	let proven = false;
	try {
		proven = ed25519.verify(
			decodeBase64UrlCapped(signature, 64),
			challengeMessage(PUT_CHALLENGE_PREFIX, decodeBase64UrlCapped(challenge, 64)),
			header.publicKey
		);
	} catch {
		proven = false;
	}
	if (!proven) throw new SignerApiError(401, 'invalid_proof', 'Invalid proof of possession');

	const hash = await sha256Hex(header.credentialId);
	const blob = bytesToBase64Url(header.raw);
	const now = Date.now();
	// This wallet's own backup under this passkey: the ed25519 proof above is the authority to replace it.
	const updated = await env.db
		.prepare(
			'UPDATE revibase_signer_wallets SET encrypted_blob = ?, updated_at = ? WHERE credential_id_hash = ? AND public_key = ? RETURNING public_key'
		)
		.bind(blob, now, hash, publicKey)
		.first<{ public_key: string }>();
	if (updated) return { ok: true, created: false };

	if (!attested)
		throw bad('webauthn_required', 'webauthnAttestationObject is required on first backup');
	const passkeyKey = bytesToBase64Url(attested.publicKey);
	const same = await env.db
		.prepare(
			'SELECT public_key FROM revibase_signer_wallets WHERE credential_id_hash = ? AND webauthn_public_key = ?'
		)
		.bind(hash, passkeyKey)
		.first<{ public_key: string }>();
	if (same)
		throw new SignerApiError(
			409,
			'wallet_conflict',
			'A different wallet is already stored for this passkey'
		);
	const count = await env.db
		.prepare('SELECT COUNT(*) AS n FROM revibase_signer_wallets WHERE credential_id_hash = ?')
		.bind(hash)
		.first<{ n: number }>();
	if ((count?.n ?? 0) >= MAX_BACKUPS_PER_CREDENTIAL)
		throw new SignerApiError(409, 'too_many_backups', 'Too many backups for this passkey');
	await env.db
		.prepare(
			`INSERT INTO revibase_signer_wallets (credential_id_hash, webauthn_public_key, public_key, encrypted_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(hash, passkeyKey, publicKey, blob, now, now)
		.run();
	return { ok: true, created: true };
}

/** Generous for a blob, an attestation or an assertion; anything bigger is refused unread. */
export const MAX_SIGNER_BODY_BYTES = 16 * 1024;

/** JSON handler for one `/api/signer/*` route; CORS is added in hooks.server.ts. */
export function signerRoute(
	fn: (env: ServerEnv, body: Record<string, unknown>) => Promise<unknown>
): RequestHandler {
	return async ({ request, platform }) => {
		const env = getEnv(platform);
		let body: Record<string, unknown> = {};
		const tooLarge = () => json({ error: 'Request too large', code: 'too_large' }, { status: 413 });
		if (Number(request.headers.get('content-length') ?? 0) > MAX_SIGNER_BODY_BYTES)
			return tooLarge();
		try {
			const text = await request.text();
			if (text.length > MAX_SIGNER_BODY_BYTES) return tooLarge();
			const parsed: unknown = text ? JSON.parse(text) : {};
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
				body = parsed as Record<string, unknown>;
		} catch {
			return json({ error: 'Invalid JSON body', code: 'bad_request' }, { status: 400 });
		}
		try {
			return json(await fn(env, body));
		} catch (err) {
			if (err instanceof SignerApiError)
				return json({ error: err.message, code: err.code }, { status: err.status });
			console.error('signer api error', err);
			return json(
				{ error: 'Something went wrong. Try again.', code: 'BLOB_UNAVAILABLE' },
				{ status: 502 }
			);
		}
	};
}
