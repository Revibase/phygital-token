/**
 * Base64 / base64url codecs used by the wire formats in this package.
 * Dependency-free so the signer Worker (`/vault`) bundles without @solana/kit.
 *
 * `decodeBase64Strict` is the decoder for attacker-controlled input: capped,
 * and it rejects non-canonical encodings. The lenient helpers below are for
 * values this code produced itself.
 */

export const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const B64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function buildLookup(alphabet: string): Int16Array {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    table[alphabet.charCodeAt(i)] = i;
  }
  return table;
}

const STD_LOOKUP = buildLookup(B64_STD);
const URL_LOOKUP = buildLookup(B64_URL);

export class DecodeError extends Error {}

/**
 * Decode a base64 / base64url string with a hard output cap.
 * @param maxBytes reject (before allocating the full result) if the decoded
 *   length would exceed this. Callers pass a tight cap from constants.
 */
export function decodeBase64Strict(
  input: string,
  maxBytes: number,
  variant: "std" | "url" = "std",
): Uint8Array {
  if (typeof input !== "string") throw new DecodeError("not a string");
  // Strip a single run of trailing '=' padding (0-2). Reject padding elsewhere.
  let end = input.length;
  let pad = 0;
  while (end > 0 && input.charCodeAt(end - 1) === 0x3d /* '=' */) {
    end--;
    pad++;
    if (pad > 2) throw new DecodeError("excess padding");
  }
  const len = end;
  // Cheap length pre-check before allocating: 4 chars -> 3 bytes.
  const approxOut = Math.floor((len * 3) / 4);
  if (approxOut > maxBytes) throw new DecodeError("too large");
  if (len % 4 === 1) throw new DecodeError("invalid length");

  const lookup = variant === "url" ? URL_LOOKUP : STD_LOOKUP;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i);
    const val = code < 128 ? lookup[code]! : -1;
    if (val < 0) throw new DecodeError("invalid character");
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      if (out.length > maxBytes) throw new DecodeError("too large");
    }
  }
  // Reject non-canonical trailing bits (must be zero) to avoid two encodings
  // mapping to the same bytes.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new DecodeError("non-canonical trailing bits");
  }
  return Uint8Array.from(out);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Standard base64 → URL-safe (`-`/`_`, no padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** URL-safe base64 (`-`/`_`, optional padding) → bytes. */
export function base64UrlToBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return base64ToBytes(padded + "=".repeat(padLen));
}
