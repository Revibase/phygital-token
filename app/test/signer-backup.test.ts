import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getAddressDecoder } from '@solana/kit';
import { challengeMessage, PUT_CHALLENGE_PREFIX } from 'secure-signer/shared';
import { VirtualAuthenticator } from 'secure-signer/testing/kit';

import { issueBackupChallenge, issueRestoreChallenge, putBlob, restoreBlob, SignerApiError } from '$lib/server/signer/backup';
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
	return { db, env, put, restore, attestationObject, address, encryptedWalletBlob };
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

	it('never stores a different wallet under the same passkey', async () => {
		const s = await setup();
		await s.put({ webauthnAttestationObject: s.attestationObject });
		const other = ed25519.utils.randomSecretKey();
		const otherAddress = getAddressDecoder().decode(ed25519.getPublicKey(other));
		expect(await code(s.put({ publicKey: otherAddress }, other))).toBe('wallet_mismatch');
	});
});
