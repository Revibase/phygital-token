import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  bufferToBase64URLString,
  utf8ToBase64URLString,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import { buildSecp256r1Message } from "../utils/passkey/internal.js";
import { verifyResponse } from "../utils/verify.js";

const expectedOrigin = "https://app.example.com";

function buildAssertion(args: {
  privateKey: Uint8Array;
  message: string;
  origin?: string;
  rpId?: string;
  signCount?: number;
  type?: string;
  flags?: number;
}): { response: AuthenticationResponseJSON; publicKey: string } {
  const publicKey = bufferToBase64URLString(p256.getPublicKey(args.privateKey, true));
  const challengeB64 = utf8ToBase64URLString(args.message);

  const clientData = {
    type: args.type ?? "webauthn.get",
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
  authData[32] = args.flags ?? 0x01;
  new DataView(authData.buffer).setUint32(33, args.signCount ?? 7, false);

  const signed = buildSecp256r1Message(
    authData,
    new TextEncoder().encode(JSON.stringify(clientData)),
  );
  const signature = bufferToBase64URLString(p256.sign(signed, args.privateKey, { format: "der" }));

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

describe("verifyResponse", async () => {
  it("rejects a registration (webauthn.create) passed off as a tap", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:create";
    const { response } = buildAssertion({ privateKey, message, type: "webauthn.create" });
    await expect(
      verifyResponse({ expectedMessage: message, expectedOrigin, response }),
    ).rejects.toMatchObject({ code: "INVALID_ASSERTION" });
  });

  it("rejects an assertion without user presence", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:no-presence";
    const { response } = buildAssertion({ privateKey, message, flags: 0x00 });
    await expect(
      verifyResponse({ expectedMessage: message, expectedOrigin, response }),
    ).rejects.toMatchObject({ code: "INVALID_ASSERTION" });
  });

  it("checks the relying party when expectedRpId is given", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:rp";
    const { response } = buildAssertion({ privateKey, message, rpId: "evil.example" });
    await expect(
      verifyResponse({
        expectedMessage: message,
        expectedOrigin,
        expectedRpId: "app.example.com",
        response,
      }),
    ).rejects.toMatchObject({ code: "RP_ID_MISMATCH" });
    const ok = buildAssertion({ privateKey, message, rpId: "app.example.com" });
    expect(
      (
        await verifyResponse({
          expectedMessage: message,
          expectedOrigin,
          expectedRpId: "app.example.com",
          response: ok.response,
        })
      ).isVerified,
    ).toBe(true);
  });

  it("verifies a tap for the issued message", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });

    const result = await verifyResponse({ expectedMessage: message, expectedOrigin, response });
    expect(result.isVerified).toBe(true);
    expect(result.secp256r1PublicKey).toBe(response.id);
    expect(Object.keys(result).sort()).toEqual(["isVerified", "secp256r1PublicKey"]);
  });

  it("verifies against a raw base64url expectedChallenge", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });
    const expectedChallenge = utf8ToBase64URLString(message);

    expect((await verifyResponse({ expectedChallenge, expectedOrigin, response })).isVerified).toBe(
      true,
    );
    await expect(
      verifyResponse({
        expectedChallenge: utf8ToBase64URLString("other"),
        expectedOrigin,
        response,
      }),
    ).rejects.toThrow(/Message mismatch/);
  });

  it("throws on message mismatch", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const { response } = buildAssertion({
      privateKey,
      message: "revibase-signin:abc",
    });

    await expect(
      verifyResponse({ expectedMessage: "revibase-signin:other", expectedOrigin, response }),
    ).rejects.toThrow(/Message mismatch/);
  });

  it("returns isVerified false on bad signature", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const otherKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message });
    // Swap id to a different key so signature won't verify
    response.id = bufferToBase64URLString(p256.getPublicKey(otherKey, true));
    response.rawId = response.id;

    const result = await verifyResponse({ expectedMessage: message, expectedOrigin, response });
    expect(result.isVerified).toBe(false);
  });

  it("rejects a tap made on another origin", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({
      privateKey,
      message,
      origin: "https://evil.example",
      rpId: "evil.example",
    });

    await expect(
      verifyResponse({ expectedMessage: message, expectedOrigin, response }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("accepts any of several expected origins", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({
      privateKey,
      message,
      origin: "https://www.example.com",
    });

    const result = await verifyResponse({
      expectedMessage: message,
      expectedOrigin: [expectedOrigin, "https://www.example.com"],
      response,
    });
    expect(result.isVerified).toBe(true);
  });

  it("rejects an empty origin in clientData", async () => {
    const privateKey = p256.utils.randomSecretKey();
    const message = "revibase-signin:abc";
    const { response } = buildAssertion({ privateKey, message, origin: "" });

    await expect(
      verifyResponse({ expectedMessage: message, expectedOrigin: "", response }),
    ).rejects.toMatchObject({ code: "INVALID_ASSERTION" });
  });
});
