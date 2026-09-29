import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Rpc, SolanaRpcApi } from "@solana/kit";

import {
  bufferToBase64URLString,
  utf8ToBase64URLString,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import { buildSecp256r1Message } from "../utils/passkey/internal.js";
import { startAuthentication, verifyResponse } from "../utils/verify.js";

const rpc = {} as Rpc<SolanaRpcApi>;

function buildAssertion(args: {
  privateKey: Uint8Array;
  message: string;
  origin?: string;
  rpId?: string;
  signCount?: number;
}): { response: AuthenticationResponseJSON; publicKey: string } {
  const publicKey = bufferToBase64URLString(
    p256.getPublicKey(args.privateKey, true),
  );
  const challengeB64 = utf8ToBase64URLString(args.message);

  const clientData = {
    type: "webauthn.get",
    challenge: challengeB64,
    origin: args.origin ?? "https://app.example.com",
    crossOrigin: false,
  };
  const clientDataJSON = bufferToBase64URLString(
    new TextEncoder().encode(JSON.stringify(clientData)),
  );

  const rpId = args.rpId ?? "app.example.com";
  const authData = new Uint8Array(37);
  authData.set(sha256(new TextEncoder().encode(rpId)), 0);
  authData[32] = 0x01;
  new DataView(authData.buffer).setUint32(33, args.signCount ?? 7, false);

  const signed = buildSecp256r1Message(
    authData,
    new TextEncoder().encode(JSON.stringify(clientData)),
  );
  const signature = bufferToBase64URLString(
    p256.sign(signed, args.privateKey, { format: "der" }),
  );

  return {
    publicKey,
    response: {
      id: publicKey,
      rawId: publicKey,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON,
        authenticatorData: bufferToBase64URLString(authData),
        signature,
      },
    },
  };
}

describe("startAuthentication / verifyResponse", () => {
  it("verifies a tap for the issued message", () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });

    const result = verifyResponse({ expectedMessage: message, response });
    expect(result.isVerified).toBe(true);
    expect(result.secp256r1PublicKey).toBe(response.id);
  });

  it("verifies against a raw base64url expectedChallenge", () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });
    const expectedChallenge = utf8ToBase64URLString(message);

    expect(verifyResponse({ expectedChallenge, response }).isVerified).toBe(true);
    expect(() =>
      verifyResponse({ expectedChallenge: utf8ToBase64URLString("other"), response }),
    ).toThrow(/Message mismatch/);
  });

  it("throws on message mismatch", () => {
    const privateKey = p256.utils.randomSecretKey();
    const { response } = buildAssertion({
      privateKey,
      message: "revibase-signin:abc",
    });

    expect(() =>
      verifyResponse({ expectedMessage: "revibase-signin:other", response }),
    ).toThrow(/Message mismatch/);
  });

  it("returns isVerified false on bad signature", () => {
    const privateKey = p256.utils.randomSecretKey();
    const otherKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });
    // Swap id to a different key so signature won't verify
    response.id = bufferToBase64URLString(p256.getPublicKey(otherKey, true));
    response.rawId = response.id;

    const result = verifyResponse({ expectedMessage: message, response });
    expect(result.isVerified).toBe(false);
  });

  it("ignores origin / rpId (no binding checks)", () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({
      privateKey,
      message,
      origin: "https://evil.example",
      rpId: "evil.example",
    });

    expect(verifyResponse({ expectedMessage: message, response }).isVerified).toBe(
      true,
    );
  });

  it("allows empty origin in clientData", () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "kiosk";
    const { response } = buildAssertion({
      privateKey,
      message,
      origin: "",
    });

    expect(verifyResponse({ expectedMessage: message, response }).isVerified).toBe(
      true,
    );
  });
});

describe("startAuthentication signature", () => {
  it("is exported and callable shape (message, rpc)", async () => {
    // Without WebAuthn / transceive this throws in authenticatePasskey — just
    // assert the function exists with the restored arity.
    expect(typeof startAuthentication).toBe("function");
    expect(startAuthentication.length).toBeGreaterThanOrEqual(1);
    void rpc;
  });
});
