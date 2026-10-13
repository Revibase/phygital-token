import { describe, expect, it } from "vitest";
import { HKDF_INFO, HKDF_INFO_LABEL, PRF_INPUT_LABEL, PRF_SALT } from "../constants.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveWrappingKey,
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  generateEd25519Seed,
  randomBytes,
  sha256,
} from "./crypto.js";
import { utf8ToBytes } from "../encoding.js";

describe("crypto", () => {
  it("HKDF -> AES-GCM wraps and unwraps a seed with AAD binding", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const aad = new TextEncoder().encode("aad-v1");
    const seed = await generateEd25519Seed();

    const key = await deriveWrappingKey(prf, salt);
    expect(key.extractable).toBe(false);
    const ct = await aesGcmEncrypt(key, iv, seed, aad);
    expect(ct.length).toBe(seed.length + 16);

    const key2 = await deriveWrappingKey(prf, salt);
    expect(key2.extractable).toBe(false);
    const pt = await aesGcmDecrypt(key2, iv, ct, aad);
    expect([...pt]).toEqual([...seed]);
  });

  it("fails to decrypt under a different AAD (auth failure -> throws)", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const seed = await generateEd25519Seed();
    const key = await deriveWrappingKey(prf, salt);
    const ct = await aesGcmEncrypt(key, iv, seed, new TextEncoder().encode("aad-A"));
    await expect(
      aesGcmDecrypt(key, iv, ct, new TextEncoder().encode("aad-B")),
    ).rejects.toBeTruthy();
  });

  it("fails to decrypt with a different PRF output", async () => {
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const aad = new TextEncoder().encode("aad");
    const seed = await generateEd25519Seed();
    const key = await deriveWrappingKey(randomBytes(32), salt);
    const ct = await aesGcmEncrypt(key, iv, seed, aad);
    const wrongKey = await deriveWrappingKey(randomBytes(32), salt);
    await expect(aesGcmDecrypt(wrongKey, iv, ct, aad)).rejects.toBeTruthy();
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const iv = randomBytes(12);
    const aad = new TextEncoder().encode("aad");
    const key = await deriveWrappingKey(prf, salt);
    const ct = await aesGcmEncrypt(key, iv, await generateEd25519Seed(), aad);
    ct[0] = ct[0]! ^ 0xff;
    await expect(aesGcmDecrypt(key, iv, ct, aad)).rejects.toBeTruthy();
  });

  it("derives an Ed25519 public key and signs verifiably via Kit", async () => {
    const seed = await generateEd25519Seed();
    const pub = await ed25519PublicKey(seed);
    const msg = randomBytes(80);
    const sig = await ed25519Sign(msg, seed);
    expect(sig.length).toBe(64);
    expect(await ed25519Verify(sig, msg, pub)).toBe(true);
  });

  it("PRF_SALT is SHA-256 of PRF_INPUT_LABEL", async () => {
    const digest = await sha256(utf8ToBytes(PRF_INPUT_LABEL));
    expect([...digest]).toEqual([...PRF_SALT]);
  });

  it("HKDF_INFO is UTF-8 of HKDF_INFO_LABEL", () => {
    expect([...HKDF_INFO]).toEqual([...utf8ToBytes(HKDF_INFO_LABEL)]);
  });
});
