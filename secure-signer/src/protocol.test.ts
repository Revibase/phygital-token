import { describe, expect, it } from "vitest";
import { validateInbound } from "./protocol.js";

const rid = "abcd1234efgh";
const base = { protocolVersion: 1, requestId: rid, timestamp: Date.now() };

describe("validateInbound", () => {
  it("accepts AUTH_START", () => {
    const r = validateInbound({ ...base, type: "AUTH_START" });
    expect(r.ok).toBe(true);
  });

  it("accepts SIGN_TRANSACTION with tx only (local blob)", () => {
    const r = validateInbound({
      ...base,
      type: "SIGN_TRANSACTION",
      transaction: "AQID",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects SIGN_TRANSACTION with parent blob (strict schema)", () => {
    const r = validateInbound({
      ...base,
      type: "SIGN_TRANSACTION",
      encryptedWalletBlob: "AAAA",
      transaction: "AQID",
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects AUTH_START with challenge fields (signer mints those)", () => {
    const r = validateInbound({
      ...base,
      type: "AUTH_START",
      putChallenge: "AAAA",
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects wrong protocol version", () => {
    const r = validateInbound({
      ...base,
      protocolVersion: 2,
      type: "AUTH_START",
    });
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_PROTOCOL" });
  });

  it("rejects unknown operation", () => {
    const r = validateInbound({ ...base, type: "IMPORT_KEY" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects unknown extra fields (strict schema)", () => {
    const r = validateInbound({ ...base, type: "AUTH_START", evil: 1 });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects missing timestamp", () => {
    const r = validateInbound({
      protocolVersion: 1,
      requestId: rid,
      type: "AUTH_START",
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects a bad requestId", () => {
    const r = validateInbound({
      protocolVersion: 1,
      requestId: "short",
      type: "AUTH_START",
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("rejects non-object payloads", () => {
    expect(validateInbound(null)).toMatchObject({ ok: false });
    expect(validateInbound("x")).toMatchObject({ ok: false });
    expect(validateInbound([1, 2, 3])).toMatchObject({ ok: false });
  });

  it("rejects an oversized message", () => {
    const r = validateInbound({
      ...base,
      type: "SIGN_TRANSACTION",
      transaction: "A".repeat(50_000),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an oversized transaction string", () => {
    const tx = "A".repeat(4096 * 2);
    const r = validateInbound({
      ...base,
      type: "SIGN_TRANSACTION",
      transaction: tx,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("accepts AUTH_START create with credentialId + attestation", () => {
    expect(
      validateInbound({
        ...base,
        type: "AUTH_START",
        authMode: "create",
        credentialId: "AAAA",
        webauthnAttestationObject: "BBBB",
      }).ok,
    ).toBe(true);
  });

  it("accepts AUTH_START unlock with no challenge fields", () => {
    const r = validateInbound({
      ...base,
      type: "AUTH_START",
      authMode: "unlock",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts EXPORT_PRIVATE_KEY", () => {
    expect(validateInbound({ ...base, type: "EXPORT_PRIVATE_KEY" }).ok).toBe(
      true,
    );
  });
});

describe("validateInbound hardening (mutation-driven)", () => {
  it.each(["!!abcd1234", "abcd1234!!", "short", "x".repeat(129)])(
    "rejects requestId %j and does not echo it back",
    (bad) => {
      const r = validateInbound({ ...base, requestId: bad, type: "EXPORT_PRIVATE_KEY" });
      expect(r).toEqual({ ok: false, code: "INVALID_MESSAGE" });
    },
  );

  it("echoes a valid requestId on UNSUPPORTED_PROTOCOL and unknown-type errors", () => {
    expect(validateInbound({ ...base, protocolVersion: 2, type: "EXPORT_PRIVATE_KEY" })).toEqual({
      ok: false,
      code: "UNSUPPORTED_PROTOCOL",
      requestId: rid,
    });
    expect(validateInbound({ ...base, type: "NOPE" })).toEqual({ ok: false, code: "INVALID_MESSAGE", requestId: rid });
  });

  it.each([Infinity, -Infinity, NaN, "1", null])("rejects a non-finite or non-number timestamp (%s)", (timestamp) => {
    expect(validateInbound({ ...base, timestamp, type: "EXPORT_PRIVATE_KEY" }).ok).toBe(false);
  });

  it.each([
    ["authMode", { authMode: "bogus" }],
    ["authMode (non-string)", { authMode: 1 }],
    ["credentialId (non-string)", { credentialId: 5 }],
    ["credentialId (empty)", { credentialId: "" }],
    ["credentialId (too long)", { credentialId: "a".repeat(400) }],
    ["webauthnAttestationObject (non-string)", { webauthnAttestationObject: {} }],
    ["webauthnAttestationObject (too long)", { webauthnAttestationObject: "a".repeat(2_000) }],
  ])("rejects AUTH_START with an invalid %s", (_, fields) => {
    expect(validateInbound({ ...base, type: "AUTH_START", ...fields })).toMatchObject({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("normalizes AUTH_START to exactly the fields supplied", () => {
    const r = validateInbound({ ...base, type: "AUTH_START", authMode: "create", credentialId: "Y3JlZA", webauthnAttestationObject: "YXR0" });
    expect(r).toEqual({
      ok: true,
      request: { ...base, type: "AUTH_START", authMode: "create", credentialId: "Y3JlZA", webauthnAttestationObject: "YXR0" },
    });
    const bare = validateInbound({ ...base, type: "AUTH_START" });
    expect(bare.ok && Object.keys(bare.request).sort()).toEqual(["protocolVersion", "requestId", "timestamp", "type"]);
  });

  it("accepts a transaction string at the size cap and rejects one byte over", () => {
    const cap = Math.ceil((4096 * 4) / 3) + 4;
    expect(validateInbound({ ...base, type: "SIGN_TRANSACTION", transaction: "A".repeat(cap) }).ok).toBe(true);
    expect(validateInbound({ ...base, type: "SIGN_TRANSACTION", transaction: "A".repeat(cap + 1) }).ok).toBe(false);
  });
});
