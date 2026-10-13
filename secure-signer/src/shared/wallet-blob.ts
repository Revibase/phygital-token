/**
 * RSS1 — the portable encrypted passkey-wallet blob.
 *
 * Produced (and decrypted) only by the secure-signer; stored opaquely by the
 * app worker, which parses just the header to key the backup (public key +
 * credential id) and to reject malformed uploads. The worker never sees a key.
 *
 * Layout (big-endian lengths):
 *   magic "RSS1" (4) | version (1) | publicKey (32) | credLen (u16) | credentialId (credLen)
 *   | kdfSalt (32) | iv (12) | ctLen (u16) | ciphertext (ctLen = 48: seed 32 + GCM tag 16)
 */
import { base64UrlToBytes as decodeBase64Url } from "./encoding.js";

export const BLOB_MAGIC = Uint8Array.from([0x52, 0x53, 0x53, 0x31]); // "RSS1"
/** Only supported version; unknown versions fail closed. */
export const BLOB_VERSION = 1 as const;
export const BLOB_PUBLIC_KEY_BYTES = 32;
export const BLOB_KDF_SALT_BYTES = 32;
export const BLOB_IV_BYTES = 12;
/** Encrypted ed25519 seed (32) + AES-GCM tag (16). */
export const BLOB_CIPHERTEXT_BYTES = 48;
/** Max encoded blob size (fixed shape + a small credential id). */
export const MAX_BLOB_BYTES = 1024;
/** Max WebAuthn credential id (the spec allows 1023; capped tighter). */
export const MAX_CREDENTIAL_ID_BYTES = 256;

export class WalletBlobParseError extends Error {
  constructor(message = "invalid_wallet_blob") {
    super(message);
    this.name = "WalletBlobParseError";
  }
}

export type WalletBlobHeader = {
  version: number;
  publicKey: Uint8Array;
  credentialId: Uint8Array;
  raw: Uint8Array;
};

function u16(b: Uint8Array, o: number): number {
  return ((b[o]! << 8) | b[o + 1]!) >>> 0;
}

/** Decode base64url with a hard size cap (rejects oversized uploads early). */
export function decodeBase64UrlCapped(input: string, maxBytes: number): Uint8Array {
  if (typeof input !== "string" || input.length === 0) {
    throw new WalletBlobParseError("empty");
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(input);
  } catch {
    throw new WalletBlobParseError("bad_base64");
  }
  if (bytes.length > maxBytes) throw new WalletBlobParseError("too_large");
  return bytes;
}

/** Parse and validate the header of a raw RSS1 blob (no decryption). */
export function parseWalletBlobHeader(raw: Uint8Array): WalletBlobHeader {
  const min =
    4 +
    1 +
    BLOB_PUBLIC_KEY_BYTES +
    2 +
    1 +
    BLOB_KDF_SALT_BYTES +
    BLOB_IV_BYTES +
    2 +
    BLOB_CIPHERTEXT_BYTES;
  if (raw.length < min || raw.length > MAX_BLOB_BYTES) {
    throw new WalletBlobParseError("size");
  }
  for (let i = 0; i < 4; i++) {
    if (raw[i] !== BLOB_MAGIC[i]) throw new WalletBlobParseError("magic");
  }
  const version = raw[4]!;
  if (version !== BLOB_VERSION) throw new WalletBlobParseError("version");
  const publicKey = raw.subarray(5, 5 + BLOB_PUBLIC_KEY_BYTES);
  const credLen = u16(raw, 37);
  if (credLen < 1 || credLen > MAX_CREDENTIAL_ID_BYTES) {
    throw new WalletBlobParseError("cred_len");
  }
  let o = 39;
  const credentialId = raw.subarray(o, o + credLen);
  o += credLen;
  o += BLOB_KDF_SALT_BYTES;
  o += BLOB_IV_BYTES;
  if (o + 2 > raw.length) throw new WalletBlobParseError("truncated");
  const ctLen = u16(raw, o);
  o += 2;
  if (ctLen !== BLOB_CIPHERTEXT_BYTES || o + ctLen !== raw.length) {
    throw new WalletBlobParseError("ciphertext");
  }
  return {
    version,
    publicKey: publicKey.slice(),
    credentialId: credentialId.slice(),
    raw,
  };
}
