import { describe, expect, it } from "vitest";
import {
  BlobError,
  buildAad,
  decodeWalletBlob,
  encodeWalletBlob,
  EXPECTED_CIPHERTEXT_BYTES,
  type WalletBlobFields,
} from "./wallet-format.js";
import { bytesEqual } from "./encoding.js";
import { MAX_BLOB_BYTES, MAX_CREDENTIAL_ID_BYTES } from "./constants.js";

function sample(): WalletBlobFields {
  return {
    publicKey: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    credentialId: Uint8Array.from({ length: 20 }, (_, i) => 200 - i),
    kdfSalt: Uint8Array.from({ length: 32 }, (_, i) => i * 2),
    iv: Uint8Array.from({ length: 12 }, (_, i) => i + 100),
    ciphertext: Uint8Array.from({ length: EXPECTED_CIPHERTEXT_BYTES }, (_, i) => i),
  };
}

describe("wallet blob", () => {
  it("round-trips encode/decode", () => {
    const f = sample();
    const parsed = decodeWalletBlob(encodeWalletBlob(f));
    expect(parsed.version).toBe(1);
    expect(bytesEqual(parsed.publicKey, f.publicKey)).toBe(true);
    expect(bytesEqual(parsed.credentialId, f.credentialId)).toBe(true);
    expect(bytesEqual(parsed.kdfSalt, f.kdfSalt)).toBe(true);
    expect(bytesEqual(parsed.iv, f.iv)).toBe(true);
    expect(bytesEqual(parsed.ciphertext, f.ciphertext)).toBe(true);
  });

  it("rejects bad magic", () => {
    const b = encodeWalletBlob(sample());
    b[0] = 0;
    expect(() => decodeWalletBlob(b)).toThrow(/magic/);
  });

  it("rejects unsupported version", () => {
    const b = encodeWalletBlob(sample());
    b[4] = 2;
    expect(() => decodeWalletBlob(b)).toThrow(/version/);
  });

  it("rejects truncation and trailing bytes", () => {
    const b = encodeWalletBlob(sample());
    expect(() => decodeWalletBlob(b.subarray(0, b.length - 3))).toThrow(BlobError);
    const extended = new Uint8Array(b.length + 1);
    extended.set(b);
    expect(() => decodeWalletBlob(extended)).toThrow(/trailing/);
  });

  it("rejects oversized blob before parsing", () => {
    expect(() => decodeWalletBlob(new Uint8Array(5000))).toThrow(/too large/);
  });

  it("rejects wrong ciphertext length (no attacker-chosen sizes)", () => {
    const f = sample();
    // hand-build a blob claiming a 64-byte ciphertext
    const good = encodeWalletBlob(f);
    // ctLen is the last u16 before ciphertext; flip it
    const ctLenOffset = good.length - EXPECTED_CIPHERTEXT_BYTES - 2;
    good[ctLenOffset] = 0;
    good[ctLenOffset + 1] = 64;
    expect(() => decodeWalletBlob(good)).toThrow(/ciphertext length/);
  });

  it("AAD is deterministic and sensitive to each bound field", () => {
    const f = sample();
    const base = buildAad(f, "signer.example.com");
    expect(bytesEqual(base, buildAad(f, "signer.example.com"))).toBe(true);
    // different rpId -> different AAD
    expect(bytesEqual(base, buildAad(f, "evil.example.com"))).toBe(false);
    // different pubkey -> different AAD
    const f2 = { ...f, publicKey: Uint8Array.from(f.publicKey).fill(9) };
    expect(bytesEqual(base, buildAad(f2, "signer.example.com"))).toBe(false);
    // different credentialId -> different AAD
    const f3 = { ...f, credentialId: Uint8Array.from(f.credentialId).fill(1) };
    expect(bytesEqual(base, buildAad(f3, "signer.example.com"))).toBe(false);
    // different salt -> different AAD
    const f4 = { ...f, kdfSalt: Uint8Array.from(f.kdfSalt).fill(3) };
    expect(bytesEqual(base, buildAad(f4, "signer.example.com"))).toBe(false);
  });
});

describe("wallet blob: field bounds (mutation-hardening)", () => {
  it.each([
    ["publicKey", { publicKey: new Uint8Array(31) }],
    ["kdfSalt", { kdfSalt: new Uint8Array(31) }],
    ["iv", { iv: new Uint8Array(11) }],
    ["ciphertext", { ciphertext: new Uint8Array(EXPECTED_CIPHERTEXT_BYTES - 1) }],
    ["empty credentialId", { credentialId: new Uint8Array(0) }],
    ["oversized credentialId", { credentialId: new Uint8Array(MAX_CREDENTIAL_ID_BYTES + 1) }],
  ])("the encoder refuses a wrong-sized %s", (_, override) => {
    expect(() => encodeWalletBlob({ ...sample(), ...override })).toThrow(BlobError);
  });

  it("accepts credential ids at both length bounds", () => {
    for (const len of [1, MAX_CREDENTIAL_ID_BYTES]) {
      const f = { ...sample(), credentialId: new Uint8Array(len).fill(9) };
      expect(decodeWalletBlob(encodeWalletBlob(f)).credentialId).toHaveLength(len);
    }
  });

  it.each([
    ["zero", 0],
    ["above the cap", MAX_CREDENTIAL_ID_BYTES + 1],
  ])("the decoder refuses a credential-id length of %s even when the bytes are present", (_, credLen) => {
    const good = encodeWalletBlob(sample());
    const head = good.slice(0, 37);
    const tail = good.slice(37 + 2 + sample().credentialId.length);
    const forged = new Uint8Array([...head, credLen >> 8, credLen & 0xff, ...new Uint8Array(credLen).fill(1), ...tail]);
    expect(() => decodeWalletBlob(forged)).toThrow(BlobError);
  });

  it("the size cap is inclusive: a blob of exactly MAX_BLOB_BYTES is not rejected for size", () => {
    const f = { ...sample(), credentialId: new Uint8Array(MAX_CREDENTIAL_ID_BYTES).fill(3) };
    const blob = encodeWalletBlob(f);
    expect(blob.length).toBeLessThanOrEqual(MAX_BLOB_BYTES);
    const padded = new Uint8Array(MAX_BLOB_BYTES + 1);
    padded.set(blob);
    expect(() => decodeWalletBlob(padded)).toThrow(/too large/);
  });

  it("the parsed public key is a copy, not a view into the input buffer", () => {
    const blob = encodeWalletBlob(sample());
    const parsed = decodeWalletBlob(blob);
    blob.fill(0);
    expect(parsed.publicKey).toEqual(sample().publicKey);
  });
});
