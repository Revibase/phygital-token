import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";

import { verifyResponse } from "../utils/verify.js";
import {
  buildProductAssertion,
  encodeProductLargeBlob,
  tapResponse,
} from "./helpers/productAssertion.js";

const privateKey = p256.utils.randomSecretKey();
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("verifyResponse", () => {
  it("returns the card's key and the precompile entry for the expected message", () => {
    const { response, publicKey, message } = buildProductAssertion({
      privateKey,
      payload: utf8("revibase-signin:abc"),
    });

    const tap = verifyResponse(response, "revibase-signin:abc");
    expect(tap.publicKey).toEqual(publicKey);
    expect(tap.message).toEqual(message);
    expect(tap.signature).toHaveLength(64);
  });

  it("takes raw bytes the same way", () => {
    const payload = new Uint8Array(32).fill(7);
    const { response } = buildProductAssertion({ privateKey, payload });
    expect(verifyResponse(response, payload).message).toEqual(
      Uint8Array.from([...utf8("authorize"), ...payload]),
    );
  });

  it("throws when the card signed a different message", () => {
    const { response } = buildProductAssertion({
      privateKey,
      payload: utf8("revibase-signin:abc"),
    });
    expect(() => verifyResponse(response, "revibase-signin:other")).toThrow(
      expect.objectContaining({ code: "INVALID_ASSERTION" }),
    );
  });

  it("throws when the blob's key didn't make the signature", () => {
    const message = Uint8Array.from([...utf8("authorize"), ...utf8("hi")]);
    const blob = encodeProductLargeBlob(
      p256.getPublicKey(privateKey, true),
      p256.sign(message, p256.utils.randomSecretKey(), { format: "der" }),
    );
    expect(() => verifyResponse(tapResponse(blob), "hi")).toThrow(
      expect.objectContaining({ code: "INVALID_ASSERTION" }),
    );
  });

  it("accepts the card's high-S signatures and returns them low-S for the precompile", () => {
    const { response, message } = buildProductAssertion({
      privateKey,
      payload: utf8("x"),
      highS: true,
    });
    const tap = verifyResponse(response, "x");
    const sig = p256.Signature.fromBytes(tap.signature, "compact");
    expect(sig.hasHighS()).toBe(false);
    expect(p256.verify(tap.signature, message, tap.publicKey)).toBe(true);
  });

  it("rejects a missing or malformed large blob", () => {
    const { response } = buildProductAssertion({ privateKey, payload: utf8("x") });
    expect(() => verifyResponse({ ...response, clientExtensionResults: {} }, "x")).toThrow(
      /largeBlob/,
    );
    expect(() => verifyResponse(tapResponse(new Uint8Array([0xa2, 0x01])), "x")).toThrow(
      /malformed/,
    );
  });
});
