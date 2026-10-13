import { describe, expect, it } from "vitest";
import { ed25519Verify, randomBytes, sha256 } from "./crypto.js";
import { decodeWalletBlob } from "./wallet-format.js";
import {
  createWallet,
  decryptWallet,
  enrollExistingCredential,
  parseBlob,
  ServiceError,
  signAndScrub,
  unwrapWallet,
  type PrfProvider,
  type PrfResult,
} from "./wallet-service.js";

const utf8 = (s: string) => new TextEncoder().encode(s);
const RP = "signer.example.com";

/** Mock PRF: a synced passkey where each credentialId maps to a stable PRF output. */
class MockPrf implements PrfProvider {
  constructor(private readonly secret: string) {}
  async create(_rpId: string, _opts: { userName: string }): Promise<PrfResult> {
    const credentialId = randomBytes(16);
    return { credentialId, prfOutput: await this.derive(credentialId) };
  }
  async get(_rpId: string, credentialId: Uint8Array): Promise<{ prfOutput: Uint8Array }> {
    return { prfOutput: await this.derive(credentialId) };
  }
  private derive(credentialId: Uint8Array): Promise<Uint8Array> {
    return sha256(new Uint8Array([...credentialId, ...utf8(this.secret)]));
  }
}

describe("wallet-service pipeline", () => {
  it("create -> import(decrypt) -> sign round-trips", async () => {
    const prf = new MockPrf("authenticator-A");
    const { publicKey, blob } = await createWallet(prf, RP, { userName: "alice" });

    const parsed = parseBlob(blob);
    const { seed, publicKey: derived } = await decryptWallet(prf, RP, parsed);
    expect([...derived]).toEqual([...publicKey]);

    const msg = randomBytes(64);
    const sig = await signAndScrub(msg, seed);
    expect(await ed25519Verify(sig, msg, publicKey)).toBe(true);
    // seed scrubbed after sign
    expect(seed.every((b) => b === 0)).toBe(true);
  });

  it("enrollExistingCredential matches create→decrypt for the same passkey", async () => {
    const prf = new MockPrf("authenticator-A");
    const created = await createWallet(prf, RP, { userName: "alice" });
    const parsed = parseBlob(created.blob);
    const again = await enrollExistingCredential(prf, RP, parsed.credentialId);
    // New seed/wallet, but same credential id binding
    expect([...parseBlob(again.blob).credentialId]).toEqual([...parsed.credentialId]);
    const { publicKey } = await decryptWallet(prf, RP, parseBlob(again.blob));
    expect([...publicKey]).toEqual([...again.publicKey]);
  });

  it("enrollExistingCredential signs after a delayed messageToSign promise", async () => {
    const prf = new MockPrf("authenticator-A");
    const created = await createWallet(prf, RP, { userName: "alice" });
    const parsed = parseBlob(created.blob);
    const msg = randomBytes(64);
    let resolveMsg!: (m: Uint8Array) => void;
    const messageToSign = new Promise<Uint8Array>((resolve) => {
      resolveMsg = resolve;
    });
    const pending = enrollExistingCredential(prf, RP, parsed.credentialId, {
      messageToSign,
    });
    resolveMsg(msg);
    const enrolled = await pending;
    expect(enrolled.signature).toBeDefined();
    expect(await ed25519Verify(enrolled.signature!, msg, enrolled.publicKey)).toBe(true);
  });

  it("fails to decrypt with a different authenticator (wrong passkey)", async () => {
    const { blob } = await createWallet(new MockPrf("authenticator-A"), RP, {
      userName: "alice",
    });
    const parsed = parseBlob(blob);
    await expect(decryptWallet(new MockPrf("authenticator-B"), RP, parsed)).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    });
  });

  it("fails to decrypt a tampered public key (AAD binding)", async () => {
    const prf = new MockPrf("authenticator-A");
    const { blob } = await createWallet(prf, RP, { userName: "alice" });
    blob[5] = blob[5]! ^ 0xff; // first byte of publicKey (offset 4 magic+1 version = 5)
    // structural decode still ok, but AAD no longer matches -> auth failure
    const parsed = decodeWalletBlob(blob);
    await expect(decryptWallet(prf, RP, parsed)).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    });
  });

  it("fails to decrypt tampered ciphertext", async () => {
    const prf = new MockPrf("authenticator-A");
    const { blob } = await createWallet(prf, RP, { userName: "alice" });
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 0xff;
    const parsed = decodeWalletBlob(blob);
    await expect(decryptWallet(prf, RP, parsed)).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    });
  });

  it("rejects a structurally corrupt blob before any crypto", () => {
    expect(() => parseBlob(new Uint8Array([1, 2, 3]))).toThrow(ServiceError);
  });

  it("binds decryption to the rpId (a different rpId fails)", async () => {
    const prf = new MockPrf("authenticator-A");
    const { blob } = await createWallet(prf, RP, { userName: "alice" });
    const parsed = parseBlob(blob);
    await expect(decryptWallet(prf, "evil.example.com", parsed)).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    });
  });
});

describe("wallet-service hardening (mutation-driven)", () => {
  it("rejects a blob whose ciphertext decrypts to a seed for a different key (WALLET_MISMATCH)", async () => {
    // Only someone holding the PRF could craft this: AAD names key A, the
    // encrypted seed is for key B. The post-decrypt check must still refuse it.
    const { deriveWrappingKey, aesGcmEncrypt, generateEd25519SeedAndPublicKey } =
      await import("./crypto.js");
    const { buildAad, encodeWalletBlob } = await import("./wallet-format.js");
    const prf = new Uint8Array(32).fill(7);
    const credentialId = new Uint8Array(16).fill(1);
    const kdfSalt = new Uint8Array(32).fill(2);
    const iv = new Uint8Array(12).fill(3);
    const claimed = await generateEd25519SeedAndPublicKey();
    const actual = await generateEd25519SeedAndPublicKey();
    const key = await deriveWrappingKey(prf, kdfSalt);
    const aad = buildAad({ publicKey: claimed.publicKey, credentialId, kdfSalt }, RP);
    const ciphertext = await aesGcmEncrypt(key, iv, actual.seed, aad);
    const blob = encodeWalletBlob({
      publicKey: claimed.publicKey,
      credentialId,
      kdfSalt,
      iv,
      ciphertext,
    });
    await expect(unwrapWallet(prf, decodeWalletBlob(blob), RP)).rejects.toMatchObject({
      code: "WALLET_MISMATCH",
    });
  });

  it("zeroes the PRF output after create, enroll and decrypt", async () => {
    const handed: Uint8Array[] = [];
    const prf: PrfProvider = {
      async create() {
        const prfOutput = new Uint8Array(32).fill(0x5a);
        handed.push(prfOutput);
        return { credentialId: new Uint8Array(16).fill(1), prfOutput };
      },
      async get() {
        const prfOutput = new Uint8Array(32).fill(0x5a);
        handed.push(prfOutput);
        return { prfOutput };
      },
    };
    const created = await createWallet(prf, RP, { userName: "u" });
    await enrollExistingCredential(prf, RP, new Uint8Array(16).fill(1));
    const { seed } = await decryptWallet(prf, RP, parseBlob(created.blob));
    seed.fill(0);
    expect(handed).toHaveLength(3);
    for (const b of handed) expect(b.every((x) => x === 0)).toBe(true);
  });

  it("signAndScrub zeroes the seed, even when signing throws", async () => {
    const seed = new Uint8Array(32).fill(9);
    await signAndScrub(utf8("m"), seed);
    expect(seed.every((x) => x === 0)).toBe(true);
    const bad = new Uint8Array(31).fill(9); // wrong length → signing throws
    await expect(signAndScrub(utf8("m"), bad)).rejects.toThrow();
    expect(bad.every((x) => x === 0)).toBe(true);
  });
});
