import { describe, expect, it } from "vitest";

import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
} from "../instructions/internal/secp256r1Verify.js";

describe("getSecp256r1VerifyInstruction", () => {
  it("builds a combined instruction for two entries", () => {
    const credential: Secp256r1VerifyEntry = {
      publicKey: new Uint8Array(33).fill(1),
      signature: new Uint8Array(64).fill(2),
      message: new Uint8Array(32).fill(3),
    };
    const enabler: Secp256r1VerifyEntry = {
      publicKey: new Uint8Array(33).fill(4),
      signature: new Uint8Array(64).fill(5),
      message: new Uint8Array(32).fill(6),
    };

    const ix = getSecp256r1VerifyInstruction([credential, enabler]);
    expect(ix.programAddress).toBe(
      "Secp256r1SigVerify1111111111111111111111111",
    );
    expect(ix.data?.length).toBeGreaterThan(0);
    expect(ix.data?.[0]).toBe(2);
  });
});
