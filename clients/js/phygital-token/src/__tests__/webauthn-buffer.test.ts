import { describe, expect, it } from "vitest";
import { bufferToBase64URLString } from "../utils/passkey/webauthn.js";

describe("bufferToBase64URLString", () => {
  it("encodes only the TypedArray view, not the full backing buffer", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = backing.subarray(2, 5); // [2, 3, 4]

    expect(bufferToBase64URLString(view)).toBe(
      bufferToBase64URLString(new Uint8Array([2, 3, 4])),
    );
    expect(bufferToBase64URLString(view)).not.toBe(
      bufferToBase64URLString(backing),
    );
  });

  it("encodes ArrayBuffer and matching Uint8Array the same way", () => {
    const bytes = new Uint8Array([10, 20, 30]);
    expect(bufferToBase64URLString(bytes.buffer)).toBe(
      bufferToBase64URLString(bytes),
    );
  });
});
