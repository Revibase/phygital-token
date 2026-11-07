import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { EnrollmentResponse } from '#lib/shared/attestation.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';

const cat = (...parts: (Uint8Array | number[])[]) =>
	Uint8Array.from(parts.flatMap((p) => Array.from(p)));

function tlv(tag: number, content: Uint8Array): Uint8Array {
	const n = content.length;
	const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
	return cat([tag], len, content);
}

/** A minimal X.509 cert: tbs{serial, SPKI bit string}, empty alg, issuer's DER signature over tbs. */
export function cert(subjectKey: Uint8Array, issuerKey: Uint8Array): Uint8Array {
	const spki = tlv(0x03, cat([0x00], p256.getPublicKey(subjectKey, false)));
	const tbs = tlv(0x30, cat(tlv(0x02, Uint8Array.of(1)), spki));
	const sig = p256.sign(tbs, issuerKey, { format: 'der' });
	return tlv(0x30, cat(tbs, tlv(0x30, new Uint8Array(0)), tlv(0x03, cat([0x00], sig))));
}

const text = (s: string) => {
	const b = new TextEncoder().encode(s);
	return cat([0x60 + b.length], b);
};
const bstr = (b: Uint8Array) =>
	b.length < 24
		? cat([0x40 + b.length], b)
		: b.length < 256
			? cat([0x58, b.length], b)
			: cat([0x59, b.length >> 8, b.length & 0xff], b);

/**
 * An enrollment as the card returns it. The leaf key signs `signedKey`'s
 * authData; `productKey` is what the authData claims (they differ to forge one).
 */
export function enrollment(opts: {
	productKey: Uint8Array;
	aaguid: Uint8Array;
	x5c: Uint8Array[];
	leafKey: Uint8Array;
	signedKey?: Uint8Array;
	clientData?: Record<string, unknown>;
}): EnrollmentResponse {
	const clientDataJSON = new TextEncoder().encode(
		JSON.stringify(opts.clientData ?? { type: 'webauthn.create' })
	);
	const authData = (key: Uint8Array) => cat(new Uint8Array(37), opts.aaguid, [0x00, 33], key);
	const sig = p256.sign(
		cat(authData(opts.signedKey ?? opts.productKey), sha256(clientDataJSON)),
		opts.leafKey,
		{ format: 'der' }
	);
	const attestationObject = cat(
		[0xa3],
		text('fmt'),
		text('packed'),
		text('authData'),
		bstr(authData(opts.productKey)),
		text('attStmt'),
		[0xa3],
		text('alg'),
		[0x26], // -7, ES256
		text('sig'),
		bstr(sig),
		text('x5c'),
		[0x80 + opts.x5c.length],
		...opts.x5c.map(bstr)
	);
	return {
		response: {
			attestationObject: bytesToBase64Url(attestationObject),
			clientDataJSON: bytesToBase64Url(clientDataJSON)
		}
	};
}

/** A Revi root, a leaf it signed, and a fresh product key: a genuine card, ready to enroll. */
export function attestedCard() {
	const rootKey = p256.utils.randomSecretKey();
	const leafKey = p256.utils.randomSecretKey();
	const root = cert(rootKey, rootKey);
	const leaf = cert(leafKey, rootKey);
	const productKey = p256.getPublicKey(p256.utils.randomSecretKey(), true);
	const aaguid = new Uint8Array(16).fill(5);
	return {
		root,
		leaf,
		leafKey,
		productKey,
		aaguid,
		enroll: (clientData?: Record<string, unknown>) =>
			enrollment({ productKey, aaguid, x5c: [leaf], leafKey, clientData })
	};
}
