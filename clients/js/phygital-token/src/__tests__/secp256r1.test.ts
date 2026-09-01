import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";

import {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
} from "../instructions/internal/secp256r1Verify.js";
import {
  base64URLStringToBuffer,
} from "../utils/passkey/webauthn.js";
import {
  buildSecp256r1Message,
  recoverSecp256r1PublicKeyCandidates,
} from "../utils/passkey/internal.js";

const CURVE_ORDER = p256.Point.CURVE().n;

function flipSignatureToHighS(signatureDer: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromBytes(signatureDer, "der");
  if (sig.hasHighS()) {
    return signatureDer;
  }
  return new p256.Signature(sig.r, CURVE_ORDER - sig.s).toBytes("der");
}

describe("recoverSecp256r1PublicKeyCandidates", () => {
  it.each([
    {
      name: "low-S WebAuthn-style signature",
      build: () => {
        const privateKey = new Uint8Array(32);
        privateKey[31] = 1;
        const message = buildSecp256r1Message(
          new Uint8Array(37).fill(9),
          new TextEncoder().encode('{"type":"webauthn.get","challenge":"abc"}'),
        );
        return {
          signatureDer: p256.sign(message, privateKey, { format: "der" }),
          message,
        };
      },
    },
    {
      name: "high-S DER signature",
      build: () => {
        const privateKey = new Uint8Array(32);
        privateKey[31] = 1;
        const message = buildSecp256r1Message(
          new Uint8Array(37).fill(4),
          new TextEncoder().encode("high-s-challenge"),
        );
        return {
          signatureDer: flipSignatureToHighS(
            p256.sign(message, privateKey, { format: "der" }),
          ),
          message,
        };
      },
    },
    {
      name: "production high-S assertion",
      build: () => ({
        message: buildSecp256r1Message(
          base64URLStringToBuffer("1ELFMhmDWdqzxz8tHNFtzPzul4nj9Mq7ZAw5eMiQJroBAAAC6w"),
          base64URLStringToBuffer(
            "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiRlFXVHN1Y1F5RmZhZG45akZVenBTQ01xc2tzdGliUXRtbVgtajc4cEowUSIsIm9yaWdpbiI6Imh0dHBzOi8vYXBwLnJldmliYXNlLmNvbSIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
          ),
        ),
        signatureDer: base64URLStringToBuffer(
          "MEUCICGG5WPSqo0zDLlTfFM8C8k4QNYhgB7GRYlUgARIuP1VAiEAvt5m1w430-F5a5YlzupNDR5yJVHE3aUvNvC--66HHS8",
        ),
      }),
    },
    {
      name: "low-S signature",
      build: () => {
        const privateKey = new Uint8Array(32);
        privateKey[31] = 1;
        const message = buildSecp256r1Message(
          new Uint8Array(37).fill(4),
          new TextEncoder().encode("ambiguous"),
        );
        return {
          signatureDer: p256.sign(message, privateKey, { format: "der" }),
          message,
        };
      },
    },
  ])("returns multiple verifying candidates for $name", ({ build }) => {
    const { signatureDer, message } = build();
    expect(recoverSecp256r1PublicKeyCandidates(signatureDer, message).length).toBeGreaterThan(1);
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
