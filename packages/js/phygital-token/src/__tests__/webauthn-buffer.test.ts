import { describe, expect, it } from "vitest";

import { fromBase64URL, toBase64URL } from "../utils/passkey/webauthn.js";

describe("base64url", () => {
  it("encodes only a view's bytes, not its whole backing buffer, and round-trips", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = backing.subarray(2, 5);
    expect(toBase64URL(view)).toBe(toBase64URL(new Uint8Array([2, 3, 4])));
    expect(fromBase64URL(toBase64URL(view))).toEqual(new Uint8Array([2, 3, 4]));
  });
});
