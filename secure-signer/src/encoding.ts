/**
 * Small, dependency-free byte<->string codecs used on the trust boundary.
 *
 * WHY hand-rolled + strict: these decode ATTACKER-CONTROLLED strings (fuzz
 * targets). They must never throw on odd input in a way that leaks state, never
 * over-allocate, and reject non-canonical encodings rather than silently
 * "fixing" them (a lenient decoder is a source of parser differentials).
 */

import { B64_STD, B64_URL, DecodeError, decodeBase64Strict } from "./shared/encoding.js";

export { DecodeError };

/**
 * Decode a base64 / base64url string with a hard output cap, rejecting
 * non-canonical input. One implementation, shared with the app worker and
 * `/vault` through `shared/encoding.ts`.
 */
export const base64ToBytes = decodeBase64Strict;

export function bytesToBase64(bytes: Uint8Array, variant: "std" | "url" = "std"): string {
  const alphabet = variant === "url" ? B64_URL : B64_STD;
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      alphabet[(n >> 18) & 63]! +
      alphabet[(n >> 12) & 63]! +
      alphabet[(n >> 6) & 63]! +
      alphabet[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
    if (variant === "std") out += "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]!;
    if (variant === "std") out += "=";
  }
  return out;
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Constant-time byte comparison for equal-length secrets/pubkeys. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
