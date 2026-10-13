/**
 * Small byte helpers shared by the harnesses. Runtime-neutral (no Node
 * Buffer, no DOM types) so every package — including the Workers-typed api —
 * can typecheck code that imports the test kit.
 */

export type Bytesish = ArrayBuffer | ArrayBufferView;

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	let len = 0;
	for (const p of parts) len += p.length;
	const out = new Uint8Array(len);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

function binary(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return s;
}

export function toBase64(bytes: Uint8Array): string {
	return btoa(binary(bytes));
}

export function toBase64Url(bytes: Uint8Array): string {
	return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
	const std = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

/** Each byte as one char code (the ciphertext encoding the signer stores in localStorage). */
export function toLatin1(bytes: Uint8Array): string {
	return binary(bytes);
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(s);
}

/** A standalone ArrayBuffer copy (never a view onto a larger pool buffer). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const out = new ArrayBuffer(bytes.length);
	new Uint8Array(out).set(bytes);
	return out;
}

/** Copy any BufferSource-like value into a fresh Uint8Array. */
export function toBytes(source: Bytesish): Uint8Array {
	if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
	return new Uint8Array(
		source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
	);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
