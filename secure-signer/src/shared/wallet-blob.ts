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
import { DecodeError, decodeBase64Strict } from "./encoding.js";

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

/** Every field of an RSS1 blob, as parsed (no decryption). */
export type ParsedWalletBlob = {
  version: number;
  publicKey: Uint8Array;
  credentialId: Uint8Array;
  kdfSalt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

export type WalletBlobHeader = {
  version: number;
  publicKey: Uint8Array;
  credentialId: Uint8Array;
  raw: Uint8Array;
};

/** Bounds-checked cursor: every read checks the remaining length first. */
class Reader {
  private o = 0;
  constructor(private readonly b: Uint8Array) {}
  private need(n: number) {
    if (this.o + n > this.b.length) throw new WalletBlobParseError("truncated");
  }
  bytes(n: number): Uint8Array {
    if (n < 0) throw new WalletBlobParseError("bad length");
    this.need(n);
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8(): number {
    this.need(1);
    return this.b[this.o++]!;
  }
  u16(): number {
    this.need(2);
    return (this.b[this.o++]! << 8) | this.b[this.o++]!;
  }
  atEnd(): boolean {
    return this.o === this.b.length;
  }
}

/**
 * Decode base64url with a hard size cap, rejecting non-canonical input (the
 * same strict decoder the signer uses, so the app worker, `/vault` and the
 * signer all accept exactly the same strings).
 */
export function decodeBase64UrlCapped(input: string, maxBytes: number): Uint8Array {
  if (typeof input !== "string" || input.length === 0) {
    throw new WalletBlobParseError("empty");
  }
  try {
    return decodeBase64Strict(input, maxBytes, "url");
  } catch (e) {
    if (e instanceof DecodeError && e.message === "too large") {
      throw new WalletBlobParseError("too_large");
    }
    throw new WalletBlobParseError("bad_base64");
  }
}

/**
 * The one RSS1 parser, used by the signer (before decryption), `/vault` and
 * the app worker. Every field is bounded; trailing bytes are rejected.
 */
export function parseWalletBlob(bytes: Uint8Array): ParsedWalletBlob {
  // Hard size cap BEFORE structural parsing.
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
  if (bytes.length < min) throw new WalletBlobParseError("too short");
  if (bytes.length > MAX_BLOB_BYTES) throw new WalletBlobParseError("too large");

  const r = new Reader(bytes);
  const magic = r.bytes(4);
  for (let i = 0; i < 4; i++) {
    if (magic[i] !== BLOB_MAGIC[i]) throw new WalletBlobParseError("bad magic");
  }
  const version = r.u8();
  if (version !== BLOB_VERSION) throw new WalletBlobParseError("unsupported version");

  const publicKey = r.bytes(BLOB_PUBLIC_KEY_BYTES).slice();
  const credLen = r.u16();
  if (credLen < 1 || credLen > MAX_CREDENTIAL_ID_BYTES) {
    throw new WalletBlobParseError("credentialId length");
  }
  const credentialId = r.bytes(credLen).slice();
  const kdfSalt = r.bytes(BLOB_KDF_SALT_BYTES).slice();
  const iv = r.bytes(BLOB_IV_BYTES).slice();
  const ctLen = r.u16();
  if (ctLen !== BLOB_CIPHERTEXT_BYTES) throw new WalletBlobParseError("ciphertext length");
  const ciphertext = r.bytes(ctLen).slice();

  // Reject trailing bytes: no ambiguity, no hidden data.
  if (!r.atEnd()) throw new WalletBlobParseError("trailing bytes");

  return { version, publicKey, credentialId, kdfSalt, iv, ciphertext };
}

/** The fields the app worker keys a backup by. */
export function parseWalletBlobHeader(raw: Uint8Array): WalletBlobHeader {
  const { version, publicKey, credentialId } = parseWalletBlob(raw);
  return { version, publicKey, credentialId, raw };
}
