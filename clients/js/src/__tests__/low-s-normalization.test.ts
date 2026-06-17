import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vitest";
import {
  base64URLStringToBuffer,
  normalizeSignatureToLowS,
} from "../utils/passkey/internal";
import { verifyLocal } from "../utils/verify";

// Real tap from a card whose secure element emits a high-S signature.
const TAP = {
  pk: "A9IZOfRZh8Uzm5bizLGzxfAL069sWyICJFYhkKAspkb_",
  c: "0000000015",
  n: "JbCaACihQK8",
  s: "IJDJZ5CMU2FgK_bAPkDLZ3kgM8cI4RhqPcXSN1p7zNb1qxZ-nK6DLGtiUfaGVxE78AppTFPOPA2yrsIzuDYbuQ",
};

function sValue(sig: Uint8Array): bigint {
  const hex = Array.from(sig.slice(32, 64))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return BigInt(`0x${hex}`);
}

describe("normalizeSignatureToLowS", () => {
  const halfOrder = p256.Point.CURVE().n >> 1n;

  it("flips a high-S signature into canonical low-S", () => {
    const raw = base64URLStringToBuffer(TAP.s);
    expect(sValue(raw) > halfOrder).toBe(true); // precondition: this tap is high-S

    const normalized = normalizeSignatureToLowS(raw);
    expect(sValue(normalized) <= halfOrder).toBe(true);
    // r is untouched
    expect(normalized.slice(0, 32)).toEqual(raw.slice(0, 32));
  });

  it("is idempotent and leaves an already-low-S signature unchanged", () => {
    const once = normalizeSignatureToLowS(base64URLStringToBuffer(TAP.s));
    expect(normalizeSignatureToLowS(once)).toEqual(once);
  });

  it("rejects non-64-byte input", () => {
    expect(() => normalizeSignatureToLowS(new Uint8Array(63))).toThrow();
  });
});

describe("verifyLocal with a high-S card signature", () => {
  it("verifies a genuine tap that emits a high-S signature", () => {
    const params = new URLSearchParams(TAP);
    const result = verifyLocal(params);
    expect(result.isVerified).toBe(true);
    expect(result.counter).toBe(15);
  });
});
