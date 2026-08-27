import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { base64URLStringToBuffer } from "./passkey/internal.js";
import type { Base64URLString } from "./passkey/webauthn.js";

/**
 * Parse a base64url-encoded 33-byte compressed secp256r1 value
 * (passkey public key **or** chip identifier — both use the same wire shape).
 */
export function parseSecp256r1Pubkey(input: Base64URLString): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("secp256r1 value is required.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(base64URLStringToBuffer(trimmed));
  } catch {
    throw new Error("Value must be valid base64url.");
  }

  if (bytes.length !== 33) {
    throw new Error("Value must decode to 33 bytes.");
  }

  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
    throw new Error("Value must be compressed (starts with 0x02 or 0x03).");
  }

  return [bytes];
}

/** Alias — chip identifiers use the same 33-byte compressed layout as passkeys. */
export const parseIdentifier = parseSecp256r1Pubkey;
