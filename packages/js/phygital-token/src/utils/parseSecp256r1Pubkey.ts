import { PhygitalTokenError } from "./errors.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { base64URLStringToBuffer } from "./passkey/webauthn.js";
import type { Base64URLString } from "./passkey/webauthn.js";

/** Parse base64url 33-byte compressed secp256r1 (passkey or chip identifier). */
export function parseSecp256r1Pubkey(input: Base64URLString): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new PhygitalTokenError(
      "INVALID_PUBLIC_KEY",
      "A passkey public key is required."
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(base64URLStringToBuffer(trimmed));
  } catch {
    throw new PhygitalTokenError(
      "INVALID_PUBLIC_KEY",
      "Invalid passkey public key: not valid base64url."
    );
  }

  if (bytes.length !== 33) {
    throw new PhygitalTokenError(
      "INVALID_PUBLIC_KEY",
      `Invalid passkey public key: expected 33 bytes, got ${bytes.length}.`
    );
  }

  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
    throw new PhygitalTokenError(
      "INVALID_PUBLIC_KEY",
      "Invalid passkey public key: must be a compressed key (starts with 0x02 or 0x03)."
    );
  }

  return [bytes];
}
