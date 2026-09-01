import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { randomBytes } from "@noble/curves/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
} from "../instructions/internal/secp256r1Verify.js";
import {
  convertSignatureDERtoRS,
  recoverSecp256r1PublicKey,
} from "../utils/passkey/internal.js";

describe("recoverSecp256r1PublicKey", () => {
  it("recovers a verifying compressed public key from a WebAuthn-style message and DER signature", () => {
    const privateKey = randomBytes(32);
    const publicKey = p256.getPublicKey(privateKey, true);
    const authenticatorData = new Uint8Array(37).fill(9);
    const clientDataJSON = new TextEncoder().encode('{"type":"webauthn.get","challenge":"abc"}');
    const message = new Uint8Array([
      ...authenticatorData,
      ...sha256(clientDataJSON),
    ]);
    const signatureDer = p256.sign(message, privateKey, {
      prehash: false,
      format: "der",
    });

    const recovered = recoverSecp256r1PublicKey(signatureDer, message);

    expect(recovered).toHaveLength(33);
    expect(recovered[0] === 0x02 || recovered[0] === 0x03).toBe(true);
    expect(
      p256.verify(convertSignatureDERtoRS(signatureDer), message, recovered, {
        prehash: false,
      }),
    ).toBe(true);
    expect(
      p256.verify(convertSignatureDERtoRS(signatureDer), message, publicKey, {
        prehash: false,
      }),
    ).toBe(true);
  });
});

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
