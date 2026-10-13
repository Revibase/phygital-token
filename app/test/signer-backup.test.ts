import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getAddressDecoder } from '@solana/kit';
import { challengeMessage, PUT_CHALLENGE_PREFIX } from 'secure-signer/shared';
import { cborEncode, VirtualAuthenticator, type CborValue } from 'secure-signer/testing/kit';

import { issueBackupChallenge, issueRestoreChallenge, MAX_SIGNER_BODY_BYTES, putBlob, restoreBlob, SignerApiError, signerRoute } from '$lib/server/signer/backup';
import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';
import { createTestD1, MIGRATIONS } from './support/d1-sqlite';

const RP_ID = 'revibase.test';
const SIGNER = 'https://signer.revibase.test';
const APP = 'https://portal.revibase.test';

const b64url = (b: ArrayBuffer | Uint8Array) => bytesToBase64Url(new Uint8Array(b));

/** An RSS1 blob header around a dummy ciphertext (the worker never decrypts). */
function blob(publicKey: Uint8Array, credentialId: Uint8Array): Uint8Array {
	const parts = [
		Uint8Array.of(0x52, 0x53, 0x53, 0x31, 1),
		publicKey,
		Uint8Array.of(credentialId.length >> 8, credentialId.length & 0xff),
		credentialId,
		new Uint8Array(32),
		new Uint8Array(12),
		Uint8Array.of(0, 48),
		new Uint8Array(48)
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	parts.reduce((o, p) => (out.set(p, o), o + p.length), 0);
	return out;
}

/**
 * A `none` attestation anyone can make: their own key under a credential id
 * they choose. Nothing binds it to a real ceremony (clientDataJSON isn't signed
 * in `none`), so the server must never let it claim someone else's passkey.
 */
function selfMadeAttestation(credentialId: Uint8Array): string {
	const key = p256.getPublicKey(p256.utils.randomSecretKey(), false);
	const cose = cborEncode(new Map<CborValue, CborValue>([[1, 2], [3, -7], [-1, 1], [-2, key.slice(1, 33)], [-3, key.slice(33, 65)]]));
	const authData = new Uint8Array([...sha256(new TextEncoder().encode(RP_ID)), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), credentialId.length >> 8, credentialId.length & 0xff, ...credentialId, ...cose]);
	return b64url(cborEncode(new Map<CborValue, CborValue>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
}

async function setup() {
	const db = createTestD1([MIGRATIONS]);
	const env = { db, rpId: RP_ID, signerOrigin: SIGNER };
	const va = new VirtualAuthenticator();
	const cred = await va.create(
		{
			publicKey: {
				challenge: new Uint8Array(32).fill(1),
				rp: { id: RP_ID, name: 'Revibase' },
				user: { id: new Uint8Array(16).fill(2), name: 'owner', displayName: 'owner' },
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				extensions: { prf: {} }
			}
		},
		{ origin: APP }
	);
	const credentialId = new Uint8Array(cred.rawId);
	const seed = ed25519.utils.randomSecretKey();
	const publicKey = ed25519.getPublicKey(seed);
	const address = getAddressDecoder().decode(publicKey);
	const encryptedWalletBlob = b64url(blob(publicKey, credentialId));

	async function put(extra: Record<string, unknown> = {}, key = seed) {
		const { challengeId, challenge } = await issueBackupChallenge(db);
		const signature = b64url(ed25519.sign(challengeMessage(PUT_CHALLENGE_PREFIX, base64UrlToBytes(challenge)), key));
		return putBlob(env, { challengeId, signature, encryptedWalletBlob, publicKey: address, ...extra });
	}
	async function restore(origin = SIGNER) {
		const { challengeId, challenge } = await issueRestoreChallenge(db);
		const got = await va.get({ publicKey: { challenge: base64UrlToBytes(challenge), rpId: RP_ID, userVerification: 'required' } }, { origin });
		const assertion = {
			id: got.id,
			rawId: b64url(got.rawId),
			type: 'public-key',
			response: {
				clientDataJSON: b64url(got.response.clientDataJSON),
				authenticatorData: b64url(got.response.authenticatorData),
				signature: b64url(got.response.signature),
				...(got.response.userHandle ? { userHandle: b64url(got.response.userHandle) } : {})
			},
			clientExtensionResults: {}
		};
		return { challengeId, assertion };
	}
	const attestationObject = b64url(cred.response.attestationObject);
	/** Someone else backing up their own wallet under this passkey's credential id. */
	async function squat() {
		const key = ed25519.utils.randomSecretKey();
		const { challengeId, challenge } = await issueBackupChallenge(db);
		return putBlob(env, {
			challengeId,
			signature: b64url(ed25519.sign(challengeMessage(PUT_CHALLENGE_PREFIX, base64UrlToBytes(challenge)), key)),
			encryptedWalletBlob: b64url(blob(ed25519.getPublicKey(key), credentialId)),
			publicKey: getAddressDecoder().decode(ed25519.getPublicKey(key)),
			webauthnAttestationObject: selfMadeAttestation(credentialId)
		});
	}
	return { db, env, put, restore, squat, attestationObject, address, encryptedWalletBlob };
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: SignerApiError) => e.code);

describe('passkey-wallet backup', () => {
	it('creates with an attestation, then restores with an assertion from that passkey', async () => {
		const s = await setup();
		expect(await s.put({ webauthnAttestationObject: s.attestationObject })).toEqual({ ok: true, created: true });
		expect(await s.put()).toEqual({ ok: true, created: false });
		const { challengeId, assertion } = await s.restore();
		expect(await restoreBlob(s.env, { challengeId, assertion })).toEqual({ encryptedWalletBlob: s.encryptedWalletBlob, publicKey: s.address });
	});

	it('needs the attestation on first backup', async () => {
		const s = await setup();
		expect(await code(s.put())).toBe('webauthn_required');
	});

	it('refuses a proof from another key and a reused challenge', async () => {
		const s = await setup();
		expect(await code(s.put({ webauthnAttestationObject: s.attestationObject }, ed25519.utils.randomSecretKey()))).toBe('invalid_proof');
		const { challengeId, challenge } = await issueBackupChallenge(s.db);
		await code(putBlob(s.env, { challengeId, signature: 'x', encryptedWalletBlob: s.encryptedWalletBlob, publicKey: s.address }));
		expect(challenge).toBeTruthy();
		expect(await code(putBlob(s.env, { challengeId, signature: 'x', encryptedWalletBlob: s.encryptedWalletBlob, publicKey: s.address }))).toBe(
			'challenge_invalid'
		);
	});

	it('restores only for a known passkey, from the signer origin, once per challenge', async () => {
		const s = await setup();
		const unknown = await s.restore();
		expect(await code(restoreBlob(s.env, unknown))).toBe('not_found');
		await s.put({ webauthnAttestationObject: s.attestationObject });
		const fromApp = await s.restore(APP);
		expect(await code(restoreBlob(s.env, fromApp))).toBe('webauthn_invalid');
		const once = await s.restore();
		expect(await code(restoreBlob(s.env, once))).toBe('ok');
		expect(await code(restoreBlob(s.env, once))).toBe('challenge_invalid');
	});

	it('a squatter on this passkey’s credential id blocks neither backup nor restore', async () => {
		const s = await setup();
		expect(await s.squat()).toEqual({ ok: true, created: true });
		expect(await s.put({ webauthnAttestationObject: s.attestationObject })).toEqual({ ok: true, created: true });
		expect(await s.put()).toEqual({ ok: true, created: false });
		const { challengeId, assertion } = await s.restore();
		expect(await restoreBlob(s.env, { challengeId, assertion })).toEqual({ encryptedWalletBlob: s.encryptedWalletBlob, publicKey: s.address });
	});

	it('caps how many backups can share one credential id', async () => {
		const s = await setup();
		await s.put({ webauthnAttestationObject: s.attestationObject });
		const results = [];
		for (let i = 0; i < 6; i++) results.push(await code(s.squat()));
		expect(results.filter((r) => r === 'ok').length).toBeLessThan(6);
		expect(results).toContain('too_many_backups');
		const { challengeId, assertion } = await s.restore();
		expect((await restoreBlob(s.env, { challengeId, assertion })).publicKey).toBe(s.address);
	});

	it('never stores a different wallet under the same passkey', async () => {
		const s = await setup();
		await s.put({ webauthnAttestationObject: s.attestationObject });
		const other = ed25519.utils.randomSecretKey();
		const otherAddress = getAddressDecoder().decode(ed25519.getPublicKey(other));
		expect(await code(s.put({ publicKey: otherAddress }, other))).toBe('wallet_mismatch');
	});
});

describe('signer API route', () => {
	const platform = (db: D1Database) =>
		({ env: { DB: db, SESSION_SECRET: 'x'.repeat(32), SOLANA_RPC_URL: 'http://127.0.0.1:8899', RP_ID, SECURE_SIGNER_ORIGIN: SIGNER } }) as unknown as App.Platform;
	const call = (body: string, headers: Record<string, string> = {}) => {
		const db = createTestD1([MIGRATIONS]);
		const handler = signerRoute((env) => issueBackupChallenge(env.db));
		const request = new Request(`${APP}/api/signer/backup-challenge`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
		return (handler as unknown as (e: unknown) => Promise<Response>)({ request, platform: platform(db) });
	};

	it('refuses an oversized body without parsing it', async () => {
		expect((await call('x'.repeat(MAX_SIGNER_BODY_BYTES + 1))).status).toBe(413);
		expect((await call('{}', { 'content-length': String(10 * MAX_SIGNER_BODY_BYTES) })).status).toBe(413);
	});

	it('answers malformed JSON with 400', async () => {
		const res = await call('{not json');
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: 'bad_request' });
	});

	it('issues a challenge for an empty or JSON body', async () => {
		expect((await call('{}')).status).toBe(200);
		expect((await call('')).status).toBe(200);
	});
});
