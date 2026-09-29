import { getBase64Decoder, getBase64Encoder } from '@solana/kit';

const base64Encoder = getBase64Encoder();
const base64Decoder = getBase64Decoder();

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(base64Encoder.encode(base64));
}

export function bytesToBase64(bytes: Uint8Array): string {
	return base64Decoder.decode(bytes);
}

/**
 * Standard base64 → URL-safe (`-`/`_`, no padding). This is the canonical
 * spelling of a chip identifier; phygital-wallet keys `tap_counters` the same
 * way, so both services share one high-water mark per chip.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const padLen = (4 - (padded.length % 4)) % 4;
	return base64ToBytes(padded + '='.repeat(padLen));
}

export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export function shortAddress(address: string): string {
	return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function accessoryTag(identifier: string): string {
	return identifier.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
}
