import { afterEach, describe, expect, it, vi } from "vitest";

import { enrollCard } from "../utils/passkey/webauthn.js";
import { PhygitalTokenError } from "../utils/errors.js";

const productKey = new Uint8Array(33).fill(2);

/** A browser whose card enrolls the same product key every time. */
function browserWithCard() {
  const create = vi.fn(async (_: CredentialCreationOptions) => ({
    id: "x",
    rawId: productKey.buffer,
    authenticatorAttachment: "cross-platform",
    response: {
      clientDataJSON: new Uint8Array([1, 2]).buffer,
      attestationObject: new Uint8Array([3, 4]).buffer,
      getTransports: () => ["nfc"],
    },
  }));
  vi.stubGlobal("PublicKeyCredential", function () {});
  vi.stubGlobal("window", { location: { hostname: "shop.test" } });
  vi.stubGlobal("navigator", { credentials: { create } });
  return create;
}

describe("enrollCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a PIN-free, non-resident ES256 key over the challenge and returns it as JSON", async () => {
    const create = browserWithCard();
    const challenge = new Uint8Array(32).fill(7);
    const response = await enrollCard(challenge);

    const options = create.mock.calls[0]![0].publicKey!;
    expect(options.challenge).toBe(challenge);
    expect(options.rp).toEqual({ name: "Revibase", id: "shop.test" });
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "discouraged",
      userVerification: "discouraged",
    });
    expect(options.attestation).toBe("direct");

    expect(response).toEqual({
      id: "x",
      rawId: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC",
      type: "public-key",
      response: { clientDataJSON: "AQI", attestationObject: "AwQ", transports: ["nfc"] },
      authenticatorAttachment: "cross-platform",
    });
  });

  it("maps a dismissed prompt to AUTHENTICATION_CANCELLED", async () => {
    browserWithCard().mockRejectedValueOnce(new DOMException("closed", "NotAllowedError"));
    await expect(enrollCard(new Uint8Array(32))).rejects.toMatchObject({
      code: "AUTHENTICATION_CANCELLED",
    });
  });

  it("refuses a browser without WebAuthn", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    const err = await enrollCard(new Uint8Array(32)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhygitalTokenError);
    expect(err).toMatchObject({ code: "WEBAUTHN_UNSUPPORTED" });
  });
});
