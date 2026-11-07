import { p256 } from "@noble/curves/nist.js";

import { PhygitalTokenError } from "./errors.js";
import {
  buildProductAllowListId,
  payloadBytes,
  readLargeBlob,
  toLowSCompact,
} from "./passkey/productKey.js";
import { tapCard, type AuthenticationResponseJSON } from "./passkey/webauthn.js";

export type { AuthenticationResponseJSON } from "./passkey/webauthn.js";

/** The card's compressed key, its low-S signature and the bytes it signed: a secp256r1 precompile entry. */
export type VerifiedTap = { publicKey: Uint8Array; signature: Uint8Array; message: Uint8Array };

/** Prompt one NFC tap asking the card to sign `authorize || payload` (a string is signed as UTF-8, 1–631 bytes). */
export async function startAuthentication(
  payload: string | Uint8Array,
  options?: { signal?: AbortSignal },
): Promise<AuthenticationResponseJSON> {
  return tapCard(buildProductAllowListId(payloadBytes(payload)), options?.signal);
}

/**
 * Check the card signed `authorize || expected`, or throw `INVALID_ASSERTION`.
 * The returned key is whatever the card reported: look it up before trusting it.
 */
export function verifyResponse(
  response: AuthenticationResponseJSON,
  expected: string | Uint8Array,
): VerifiedTap {
  const message = buildProductAllowListId(payloadBytes(expected));
  const { publicKey, signatureDer } = readLargeBlob(response);
  let valid: boolean;
  try {
    valid = p256.verify(signatureDer, message, publicKey, { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new PhygitalTokenError(
      "INVALID_ASSERTION",
      "The tag didn't sign this message. Tap the tag again.",
    );
  }
  return { publicKey, signature: toLowSCompact(signatureDer), message };
}
