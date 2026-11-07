import { p256 } from "@noble/curves/nist.js";

import { PhygitalTokenError } from "../errors.js";
import { AUTHORIZE_PREFIX, MAX_AUTHORIZE_PAYLOAD } from "../consts.js";
import { fromBase64URL, type AuthenticationResponseJSON } from "./webauthn.js";

const CURVE_ORDER = p256.Point.CURVE().n;

/** UTF-8 for a string, the bytes themselves otherwise. */
export function payloadBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

/**
 * The bytes the card signs for `payload`: `authorize || payload`.
 * `payload` must be 1–{@link MAX_AUTHORIZE_PAYLOAD} bytes; the card refuses a prefix-only id.
 */
export function buildProductAllowListId(payload: Uint8Array): Uint8Array<ArrayBuffer> {
  if (payload.length < 1 || payload.length > MAX_AUTHORIZE_PAYLOAD) {
    throw new PhygitalTokenError(
      "INVALID_ARGUMENT",
      `Product-key payload must be 1–${MAX_AUTHORIZE_PAYLOAD} bytes (got ${payload.length}).`,
    );
  }
  const id = new Uint8Array(AUTHORIZE_PREFIX.length + payload.length);
  id.set(AUTHORIZE_PREFIX, 0);
  id.set(payload, AUTHORIZE_PREFIX.length);
  return id;
}

/**
 * Read the card's large blob, which it always writes as the CBOR map
 * `{1: bstr(33) compressed public key, 2: bstr(DER signature over the signed id)}`:
 * `a2 01 58 21 <pubkey> 02 58 <len> <der>`.
 */
export function readLargeBlob(response: AuthenticationResponseJSON): {
  publicKey: Uint8Array;
  signatureDer: Uint8Array;
} {
  const encoded = response.clientExtensionResults?.largeBlob?.blob;
  if (!encoded) {
    throw new PhygitalTokenError(
      "INVALID_ASSERTION",
      "Missing largeBlob from the tap (the request must ask for largeBlob: { read: true }).",
    );
  }
  const blob = fromBase64URL(encoded);
  const derLen = blob[39] ?? 0;
  if (
    blob[0] !== 0xa2 ||
    blob[1] !== 0x01 ||
    blob[2] !== 0x58 ||
    blob[3] !== 33 ||
    blob[37] !== 0x02 ||
    blob[38] !== 0x58 ||
    blob.length !== 40 + derLen
  ) {
    throw new PhygitalTokenError("INVALID_ASSERTION", "The tap's large blob is malformed.");
  }
  return { publicKey: blob.subarray(4, 37), signatureDer: blob.subarray(40) };
}

/** DER → 64-byte compact `r || s` with low S, the form the secp256r1 precompile accepts. */
export function toLowSCompact(signatureDer: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromBytes(signatureDer, "der");
  return (sig.hasHighS() ? new p256.Signature(sig.r, CURVE_ORDER - sig.s) : sig).toBytes("compact");
}
