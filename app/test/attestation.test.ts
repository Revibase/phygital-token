import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';

import { verifyClientData, verifyMakeCredentialAttestation } from '#lib/shared/attestation.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';
import { attestedCard, cert, enrollment } from './support/attestation';
import { ORIGIN } from './support/fixtures';

describe('verifyMakeCredentialAttestation', () => {
	const { root, leaf, leafKey, productKey, aaguid, enroll } = attestedCard();
	const genuine = enroll();

	it('returns the product key when the leaf signed it and x5c chains to a trusted root', () => {
		expect(
			verifyMakeCredentialAttestation(genuine, { rootCertDers: [root], expectedAaguid: aaguid })
		).toEqual({ publicKey: productKey, aaguid });
	});

	it("rejects a genuine x5c attached to a key the card didn't attest", () => {
		const forged = enrollment({
			productKey: p256.getPublicKey(p256.utils.randomSecretKey(), true),
			signedKey: productKey,
			aaguid,
			x5c: [leaf],
			leafKey
		});
		expect(() => verifyMakeCredentialAttestation(forged, { rootCertDers: [root] })).toThrow(
			/isn't signed by the x5c leaf/
		);
	});

	it('rejects a chain to another root, or the wrong AAGUID', () => {
		const otherKey = p256.utils.randomSecretKey();
		const other = cert(otherKey, otherKey);
		expect(() => verifyMakeCredentialAttestation(genuine, { rootCertDers: [other] })).toThrow(
			/trusted root/
		);
		expect(() =>
			verifyMakeCredentialAttestation(genuine, {
				rootCertDers: [root],
				expectedAaguid: new Uint8Array(16)
			})
		).toThrow(/AAGUID/);
	});
});

describe('verifyClientData', () => {
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const origin = ORIGIN;
	const response = (clientData: Record<string, unknown>) =>
		enrollment({
			productKey: p256.getPublicKey(p256.utils.randomSecretKey(), true),
			aaguid: new Uint8Array(16),
			x5c: [],
			leafKey: p256.utils.randomSecretKey(),
			clientData
		});
	const good = { type: 'webauthn.create', challenge: bytesToBase64Url(challenge), origin };

	it('accepts a create on this origin over the issued challenge', () => {
		expect(() => verifyClientData(response(good), { challenge, origin })).not.toThrow();
	});

	it('rejects an assertion, another challenge, or another origin', () => {
		expect(() =>
			verifyClientData(response({ ...good, type: 'webauthn.get' }), { challenge, origin })
		).toThrow(/webauthn.create/);
		expect(() =>
			verifyClientData(response({ ...good, challenge: bytesToBase64Url(new Uint8Array(32)) }), {
				challenge,
				origin
			})
		).toThrow(/Challenge/);
		expect(() =>
			verifyClientData(response({ ...good, origin: 'https://evil.example' }), { challenge, origin })
		).toThrow(/Origin/);
	});
});
