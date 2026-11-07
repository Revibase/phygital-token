import { p256 } from '@noble/curves/nist.js';
import { concatBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64UrlToBytes, bytesEqual } from './encoding';

/**
 * The parts of an enrollment (the SDK's `RegistrationResponseJSON`) the checks
 * read, base64url-encoded. Everything else in it is ignored.
 */
export type EnrollmentResponse = {
	response: { clientDataJSON: string; attestationObject: string };
};

function invalid(message: string): Error {
	return new Error(`Invalid card attestation: ${message}`);
}

/** Minimal CBOR decoder for the attestationObject's maps, arrays, bytes and text. */
function decodeCbor(data: Uint8Array, offset = 0): { value: unknown; offset: number } {
	if (offset >= data.length) throw invalid('Truncated CBOR in attestationObject.');
	const ib = data[offset];
	const major = ib >> 5;
	const additional = ib & 0x1f;
	let pos = offset + 1;
	let len = additional;
	if (additional >= 24 && additional <= 26) {
		const width = 1 << (additional - 24);
		len = 0;
		for (let i = 0; i < width; i += 1) len = len * 256 + data[pos++];
	} else if (additional > 26) {
		throw invalid(`Unsupported CBOR additional info ${additional}.`);
	}

	switch (major) {
		case 0:
			return { value: len, offset: pos };
		case 1:
			return { value: -1 - len, offset: pos };
		case 2:
			return { value: data.slice(pos, pos + len), offset: pos + len };
		case 3:
			return { value: new TextDecoder().decode(data.subarray(pos, pos + len)), offset: pos + len };
		case 4: {
			const arr: unknown[] = [];
			for (let i = 0; i < len; i += 1) {
				const next = decodeCbor(data, pos);
				arr.push(next.value);
				pos = next.offset;
			}
			return { value: arr, offset: pos };
		}
		case 5: {
			const map = new Map<unknown, unknown>();
			for (let i = 0; i < len; i += 1) {
				const k = decodeCbor(data, pos);
				const v = decodeCbor(data, k.offset);
				map.set(k.value, v.value);
				pos = v.offset;
			}
			return { value: map, offset: pos };
		}
		default:
			throw invalid(`Unsupported CBOR major type ${major}.`);
	}
}

function asBytes(value: unknown, label: string): Uint8Array {
	if (!(value instanceof Uint8Array)) throw invalid(`${label} must be bytes.`);
	return value;
}

/** Reads one DER tag + length at `pos`; returns where the content starts and ends. */
function readTlv(der: Uint8Array, pos: number, tag: number, label: string) {
	if (der[pos] !== tag) throw invalid(`${label} missing.`);
	let len = der[pos + 1];
	let start = pos + 2;
	if (len >= 0x80) {
		const n = len & 0x7f;
		len = 0;
		for (let i = 0; i < n; i += 1) len = len * 256 + der[start++];
	}
	return { start, end: start + len };
}

/** `tbsCertificate` (with its header) and the DER ECDSA signature of an X.509 certificate. */
function tbsAndSigFromCert(der: Uint8Array): { tbs: Uint8Array; sig: Uint8Array } {
	const cert = readTlv(der, 0, 0x30, 'Certificate');
	const tbs = readTlv(der, cert.start, 0x30, 'tbsCertificate');
	const alg = readTlv(der, tbs.end, 0x30, 'signatureAlgorithm');
	const sig = readTlv(der, alg.end, 0x03, 'signatureValue');
	if (der[sig.start] !== 0x00) throw invalid('Unexpected signature BIT STRING padding.');
	return { tbs: der.subarray(cert.start, tbs.end), sig: der.subarray(sig.start + 1, sig.end) };
}

/** The uncompressed P-256 key in a certificate's SubjectPublicKeyInfo. */
function spkiFromCert(der: Uint8Array): Uint8Array {
	// BIT STRING (0x03 0x42) holding 0x00 || 0x04 || X || Y.
	for (let i = 0; i < der.length - 68; i += 1) {
		if (der[i] === 0x03 && der[i + 1] === 0x42 && der[i + 2] === 0x00 && der[i + 3] === 0x04) {
			return der.subarray(i + 3, i + 3 + 65);
		}
	}
	throw invalid('Could not find P-256 SPKI in certificate.');
}

/** ES256 / ecdsa-with-SHA256 over `message`; `p256.verify` hashes it. */
function verifiesDer(sig: Uint8Array, message: Uint8Array, certDer: Uint8Array): boolean {
	try {
		return p256.verify(sig, message, spkiFromCert(certDer), { format: 'der', lowS: false });
	} catch {
		return false;
	}
}

function isSignedBy(childDer: Uint8Array, issuerDer: Uint8Array): boolean {
	const { tbs, sig } = tbsAndSigFromCert(childDer);
	return verifiesDer(sig, tbs, issuerDer);
}

/**
 * Check an enrollment's `clientDataJSON`: a `webauthn.create` made on `origin`
 * over `challenge`. The browser writes these fields, so they bind the
 * enrollment to this page and to one server-issued challenge.
 */
export function verifyClientData(
	response: EnrollmentResponse,
	expected: { challenge: Uint8Array; origin: string }
): void {
	let clientData: { type?: unknown; challenge?: unknown; origin?: unknown };
	try {
		clientData = JSON.parse(
			new TextDecoder().decode(base64UrlToBytes(response.response.clientDataJSON))
		) as typeof clientData;
	} catch {
		throw invalid('clientDataJSON is not JSON.');
	}
	if (clientData.type !== 'webauthn.create') throw invalid('Not a webauthn.create response.');
	if (
		typeof clientData.challenge !== 'string' ||
		!bytesEqual(base64UrlToBytes(clientData.challenge), expected.challenge)
	) {
		throw invalid('Challenge mismatch.');
	}
	if (clientData.origin !== expected.origin) throw invalid('Origin mismatch.');
}

export type VerifyAttestationOptions = {
	/** Trusted root CA DER certificate(s). */
	rootCertDers: readonly Uint8Array[];
	/** Optional expected AAGUID (16 bytes). */
	expectedAaguid?: Uint8Array;
};

export type VerifiedMakeCredentialAttestation = {
	/** The card's 33-byte compressed product public key (the credential id). */
	publicKey: Uint8Array;
	aaguid: Uint8Array;
};

/**
 * Check an enrollment's packed attestation: the card's attestation key signed
 * this enrollment, and its `x5c` chains to one of `rootCertDers` (the root
 * itself doesn't need to be in `x5c`). Returns the product public key.
 */
export function verifyMakeCredentialAttestation(
	response: EnrollmentResponse,
	options: VerifyAttestationOptions
): VerifiedMakeCredentialAttestation {
	const { value } = decodeCbor(base64UrlToBytes(response.response.attestationObject));
	if (!(value instanceof Map)) throw invalid('attestationObject is not a CBOR map.');
	const map = value as Map<unknown, unknown>;
	const fmt = map.get('fmt');
	if (fmt !== 'packed') throw invalid(`Expected fmt packed, got ${String(fmt)}.`);
	const authData = asBytes(map.get('authData'), 'authData');
	const attStmt = map.get('attStmt');
	if (!(attStmt instanceof Map)) throw invalid('attStmt missing.');
	const stmt = attStmt as Map<unknown, unknown>;
	const x5cRaw = stmt.get('x5c');
	if (!Array.isArray(x5cRaw) || x5cRaw.length < 1) {
		throw invalid('attStmt.x5c required for CA attestation.');
	}
	const x5c = x5cRaw.map((c, i) => asBytes(c, `x5c[${i}]`));
	if (stmt.get('alg') !== -7) throw invalid('Expected an ES256 attestation signature.');
	const signed = concatBytes(authData, sha256(base64UrlToBytes(response.response.clientDataJSON)));
	if (!verifiesDer(asBytes(stmt.get('sig'), 'attStmt.sig'), signed, x5c[0])) {
		throw invalid("The attestation isn't signed by the x5c leaf certificate.");
	}

	if (authData.length < 37 + 16 + 2 + 33)
		throw invalid('authData too short for product credential.');
	const aaguid = authData.slice(37, 53);
	if (options.expectedAaguid?.length === 16 && !bytesEqual(aaguid, options.expectedAaguid)) {
		throw invalid('AAGUID mismatch.');
	}
	const credIdLen = (authData[53] << 8) | authData[54];
	if (credIdLen !== 33) throw invalid(`Expected 33-byte product credential id, got ${credIdLen}.`);
	const publicKey = authData.slice(55, 55 + 33);
	if (publicKey[0] !== 0x02 && publicKey[0] !== 0x03) {
		throw invalid('Credential id is not a compressed P-256 key.');
	}

	for (let i = 0; i < x5c.length - 1; i += 1) {
		if (!isSignedBy(x5c[i], x5c[i + 1])) throw invalid(`x5c[${i}] not signed by next certificate.`);
	}
	const last = x5c[x5c.length - 1];
	const anchored = options.rootCertDers.some(
		(root) => bytesEqual(last, root) || isSignedBy(last, root)
	);
	if (!anchored) throw invalid('x5c does not chain to a trusted root.');

	return { publicKey, aaguid };
}
