/**
 * Portable encrypted wallet blob: a small, versioned, self-describing DETERMINISTIC
 * BINARY format. Deliberately not free-form JSON so the AES-GCM AAD is
 * an unambiguous byte string, and so a malicious parent cannot smuggle extra
 * fields or reorder them.
 *
 * The blob is treated as PUBLIC CIPHERTEXT: holding it must not by itself
 * reveal the key. Every cleartext field is bound as AAD, so tampering fails
 * decryption; after decryption we additionally re-derive the public key and
 * require it to match the stored one.
 *
 * Layout (big-endian lengths):
 *   magic[4] "RSS1" | version[1] | publicKey[32] |
 *   credIdLen[u16] | credentialId[credIdLen] |
 *   kdfSalt[32] | iv[12] | ctLen[u16] | ciphertext[ctLen]
 */

import {
  AES_GCM_IV_BYTES,
  BLOB_MAGIC,
  BLOB_VERSION,
  ED25519_PUBKEY_BYTES,
  HKDF_INFO,
  KDF_SALT_BYTES,
  MAX_CREDENTIAL_ID_BYTES,
} from "../constants.js";
import { utf8ToBytes } from "../encoding.js";
import {
  BLOB_CIPHERTEXT_BYTES,
  parseWalletBlob,
  WalletBlobParseError,
  type ParsedWalletBlob,
} from "../shared/wallet-blob.js";

/** seed(32) + GCM tag(16) = fixed 48. Attacker-chosen sizes are rejected. */
export const EXPECTED_CIPHERTEXT_BYTES = BLOB_CIPHERTEXT_BYTES;

export class BlobError extends Error {}

export interface WalletBlobFields {
  publicKey: Uint8Array; // 32
  credentialId: Uint8Array; // <= MAX_CREDENTIAL_ID_BYTES
  kdfSalt: Uint8Array; // 32
  iv: Uint8Array; // 12
  ciphertext: Uint8Array; // 48
}

export type { ParsedWalletBlob };

function writeU16(n: number): Uint8Array {
  if (n < 0 || n > 0xffff) throw new BlobError("u16 overflow");
  return Uint8Array.from([(n >> 8) & 0xff, n & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
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

export function encodeWalletBlob(f: WalletBlobFields): Uint8Array {
  if (f.publicKey.length !== ED25519_PUBKEY_BYTES) throw new BlobError("pubkey");
  if (f.kdfSalt.length !== KDF_SALT_BYTES) throw new BlobError("salt");
  if (f.iv.length !== AES_GCM_IV_BYTES) throw new BlobError("iv");
  if (f.ciphertext.length !== EXPECTED_CIPHERTEXT_BYTES) throw new BlobError("ct");
  if (f.credentialId.length < 1 || f.credentialId.length > MAX_CREDENTIAL_ID_BYTES)
    throw new BlobError("credentialId");
  return concat([
    BLOB_MAGIC,
    Uint8Array.from([BLOB_VERSION]),
    f.publicKey,
    writeU16(f.credentialId.length),
    f.credentialId,
    f.kdfSalt,
    f.iv,
    writeU16(f.ciphertext.length),
    f.ciphertext,
  ]);
}

/**
 * Strict decode. `bytes` is attacker-controlled; the shared parser bounds every
 * field. Failures are reported as `BlobError`.
 */
export function decodeWalletBlob(bytes: Uint8Array): ParsedWalletBlob {
  try {
    return parseWalletBlob(bytes);
  } catch (e) {
    if (e instanceof WalletBlobParseError) throw new BlobError(e.message);
    throw e;
  }
}

/**
 * Deterministic AAD binding the security-sensitive metadata. Built from the
 * PARSED header fields plus the implementation-fixed rpId and HKDF label, so any
 * tamper of publicKey / credentialId / salt flips the AAD and fails GCM auth.
 * The `iv` is the GCM nonce and is intentionally not duplicated here.
 */
export function buildAad(
  header: Pick<ParsedWalletBlob, "publicKey" | "credentialId" | "kdfSalt">,
  rpId: string,
): Uint8Array {
  const rp = utf8ToBytes(rpId);
  return concat([
    BLOB_MAGIC,
    Uint8Array.from([BLOB_VERSION]),
    header.publicKey,
    writeU16(header.credentialId.length),
    header.credentialId,
    header.kdfSalt,
    writeU16(rp.length),
    rp,
    writeU16(HKDF_INFO.length),
    HKDF_INFO,
  ]);
}
