import {
  createKeyPairFromPrivateKeyBytes,
  createPrivateKeyFromBytes,
  generateKeyPair,
  signBytes,
  signatureBytes,
  verifySignature,
} from "@solana/kit";

import { AES_GCM_TAG_BITS, AES_KEY_BITS, ED25519_PUBKEY_BYTES, HKDF_INFO } from "./constants.js";
import { base64ToBytes } from "./encoding.js";

const subtle = globalThis.crypto.subtle;
const ED25519_SEED_BYTES = 32;

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Best-effort; JS cannot guarantee memory wipe. */
export function scrub(...buffers: Array<Uint8Array | undefined>): void {
  for (const b of buffers) if (b) b.fill(0);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

export async function deriveWrappingKey(
  prfOutput: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", prfOutput as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: HKDF_INFO as BufferSource,
    },
    base,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const ct = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    plaintext as BufferSource,
  );
  return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertextWithTag: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const pt = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad as BufferSource,
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    ciphertextWithTag as BufferSource,
  );
  return new Uint8Array(pt);
}

export async function generateEd25519Seed(): Promise<Uint8Array> {
  const { seed } = await generateEd25519SeedAndPublicKey();
  return seed;
}

/** Extractable generateKeyPair only to export seed bytes for AES wrap. */
export async function generateEd25519SeedAndPublicKey(): Promise<{
  seed: Uint8Array;
  publicKey: Uint8Array;
}> {
  const { privateKey, publicKey: pubCryptoKey } = await generateKeyPair(true);
  const jwk = await subtle.exportKey("jwk", privateKey);
  if (typeof jwk.d !== "string") throw new Error("missing private key");
  const seed = base64ToBytes(jwk.d, ED25519_SEED_BYTES, "url");
  if (seed.length !== ED25519_SEED_BYTES) throw new Error("bad seed length");
  const publicKey = new Uint8Array(await subtle.exportKey("raw", pubCryptoKey));
  if (publicKey.length !== ED25519_PUBKEY_BYTES) {
    scrub(seed);
    throw new Error("bad pubkey length");
  }
  return { seed, publicKey };
}

export async function ed25519PublicKey(seed: Uint8Array): Promise<Uint8Array> {
  const { publicKey } = await createKeyPairFromPrivateKeyBytes(seed, false);
  const pub = new Uint8Array(await subtle.exportKey("raw", publicKey));
  if (pub.length !== ED25519_PUBKEY_BYTES) throw new Error("bad pubkey length");
  return pub;
}

export async function ed25519Sign(message: Uint8Array, seed: Uint8Array): Promise<Uint8Array> {
  const privateKey = await createPrivateKeyFromBytes(seed, false);
  return new Uint8Array(await signBytes(privateKey, message));
}

export async function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKeyBytes: Uint8Array,
): Promise<boolean> {
  const publicKey = await subtle.importKey(
    "raw",
    publicKeyBytes as BufferSource,
    { name: "Ed25519" },
    true,
    ["verify"],
  );
  return verifySignature(publicKey, signatureBytes(signature), message);
}
