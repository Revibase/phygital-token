import { Endian, getU32Encoder } from '@solana/kit';
import { p256 } from '@noble/curves/nist.js';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';

/**
 * Port of phygital-wallet `apps/api/src/tap/verify-dynamic-url.ts` (same crypto
 * as revibase vault / phygital-token-sdk ≤0.13). phygital-token-sdk ≥0.14
 * deliberately ships no signed-URL helper, so it lives here.
 */

export type VerifyDynamicUrlResult = {
	isVerified: boolean;
	/**
	 * Canonical base64url of the 33-byte chip key, re-encoded from the decoded
	 * bytes. The decoder also accepts padding, so the raw `pk` string has many
	 * spellings; the counter must be keyed on exactly one of them.
	 */
	identifier: string;
	counter: number;
};

export class TapParamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TapParamError';
	}
}

const CURVE_ORDER = p256.Point.CURVE().n;

/** ECDSA low-S normalization for P-256 raw r||s signatures. */
function normalizeSignatureToLowS(signature: Uint8Array): Uint8Array {
	const sig = p256.Signature.fromBytes(signature, 'compact');
	if (!sig.hasHighS()) return signature;
	return new p256.Signature(sig.r, CURVE_ORDER - sig.s).toBytes('compact');
}

function decodeParam(value: string, name: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
		throw new TapParamError(`${name} must be base64url`);
	}
	return base64UrlToBytes(value);
}

/**
 * Verify an NFC dynamic-URL tap (`pk` / `s` / `c` / `n`) without consuming a
 * counter. The chip signs the raw 12-byte `counter(u32 BE) || nonce` message.
 *
 * Signature validity alone is NOT replay protection: the caller must atomically
 * advance the counter high-water mark (see `counter-store.ts`).
 */
export function verifyDynamicUrlWithoutCounterCheck(
	params: URLSearchParams
): VerifyDynamicUrlResult {
	const identifier = params.get('pk');
	const signature = params.get('s');
	const counter = params.get('c');
	const nonce = params.get('n');
	if (!identifier || !signature || !counter || !nonce) {
		throw new TapParamError('Missing tap parameters');
	}

	const compressedPk = decodeParam(identifier, 'pk');
	if (compressedPk.length !== 33 || (compressedPk[0] !== 0x02 && compressedPk[0] !== 0x03)) {
		throw new TapParamError(`pk must be 33-byte compressed P-256 key, got ${compressedPk.length} bytes`);
	}
	const randomBytes = decodeParam(nonce, 'n');
	if (randomBytes.length !== 8) {
		throw new TapParamError(`n must be 8 bytes, got ${randomBytes.length} bytes`);
	}
	const rawSig = decodeParam(signature, 's');
	if (rawSig.length !== 64) {
		throw new TapParamError(`s must be 64-byte raw ECDSA signature, got ${rawSig.length} bytes`);
	}
	if (!/^\d{1,10}$/.test(counter)) {
		throw new TapParamError('counter must be a decimal uint32');
	}
	const currentCounter = Number.parseInt(counter, 10);
	if (!Number.isInteger(currentCounter) || currentCounter < 0 || currentCounter > 0xffffffff) {
		throw new TapParamError(`counter out of uint32 range: ${currentCounter}`);
	}

	const message = new Uint8Array(12);
	message.set(getU32Encoder({ endian: Endian.Big }).encode(currentCounter), 0);
	message.set(randomBytes, 4);

	let isVerified = false;
	try {
		isVerified = p256.verify(normalizeSignatureToLowS(rawSig), message, compressedPk);
	} catch {
		// Malformed curve point / scalar out of range → not a valid tap.
		isVerified = false;
	}

	return {
		isVerified,
		identifier: bytesToBase64Url(compressedPk),
		counter: currentCounter
	};
}
