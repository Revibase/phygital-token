/**
 * Minimal canonical CBOR encoder: exactly what WebAuthn attestation objects
 * and COSE keys need (ints, byte strings, text strings, maps). Keeping it tiny
 * avoids pulling a verifier library into the code that fakes the authenticator.
 * The self-tests decode its output with @simplewebauthn/server.
 */

export type CborValue = number | Uint8Array | string | Map<CborValue, CborValue>;

function head(major: number, value: number): Uint8Array {
	const m = major << 5;
	if (value < 24) return Uint8Array.of(m | value);
	if (value < 0x100) return Uint8Array.of(m | 24, value);
	if (value < 0x10000) return Uint8Array.of(m | 25, value >> 8, value & 0xff);
	return Uint8Array.of(
		m | 26,
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff
	);
}

export function cborEncode(value: CborValue): Uint8Array {
	const parts: Uint8Array[] = [];
	const push = (v: CborValue): void => {
		if (typeof v === 'number') {
			if (!Number.isInteger(v)) throw new Error('cbor: only integers');
			parts.push(v >= 0 ? head(0, v) : head(1, -1 - v));
		} else if (v instanceof Uint8Array) {
			parts.push(head(2, v.length), v);
		} else if (typeof v === 'string') {
			const b = new TextEncoder().encode(v);
			parts.push(head(3, b.length), b);
		} else {
			parts.push(head(5, v.size));
			for (const [k, val] of v) {
				push(k);
				push(val);
			}
		}
	};
	push(value);
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
