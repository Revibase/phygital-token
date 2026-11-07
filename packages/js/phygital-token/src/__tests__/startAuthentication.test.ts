import { afterEach, describe, expect, it, vi } from "vitest";
import { p256 } from "@noble/curves/nist.js";

import { startAuthentication } from "../utils/verify.js";
import { browserRpId } from "../utils/passkey/webauthn.js";
import { encodeProductLargeBlob } from "./helpers/productAssertion.js";

const bytes = (buffer: BufferSource) =>
  new Uint8Array(ArrayBuffer.isView(buffer) ? buffer.buffer : buffer);

/** A browser whose card signs whatever allowList id it's asked for. */
function browserWithCard() {
  const privateKey = p256.utils.randomSecretKey();
  const get = vi.fn(async ({ publicKey }: CredentialRequestOptions) => {
    const id = bytes(publicKey!.allowCredentials![0]!.id);
    const blob = encodeProductLargeBlob(
      p256.getPublicKey(privateKey, true),
      p256.sign(id, privateKey, { format: "der" }),
    );
    return {
      id: "x",
      rawId: id.buffer,
      authenticatorAttachment: "cross-platform",
      response: {
        clientDataJSON: new ArrayBuffer(1),
        authenticatorData: new ArrayBuffer(37),
        signature: new ArrayBuffer(8),
        userHandle: null,
      },
      getClientExtensionResults: () => ({ largeBlob: { blob: blob.buffer } }),
    };
  });
  vi.stubGlobal("PublicKeyCredential", function () {});
  vi.stubGlobal("window", { location: { hostname: "shop.test" } });
  vi.stubGlobal("navigator", { credentials: { get } });
  return get;
}

/** A browser that holds one prompt at a time until its signal aborts. */
function browserWaitingForTap() {
  let pending = false;
  const get = vi.fn(({ signal }: CredentialRequestOptions) => {
    if (pending)
      return Promise.reject(new DOMException("A request is already pending.", "NotAllowedError"));
    pending = true;
    return new Promise((_, reject) =>
      signal?.addEventListener("abort", () => {
        pending = false;
        reject(signal.reason);
      }),
    );
  });
  vi.stubGlobal("PublicKeyCredential", function () {});
  vi.stubGlobal("navigator", { credentials: { get } });
  return get;
}

describe("startAuthentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the card to sign authorize || UTF-8(message), one tap, and returns its blob", async () => {
    const get = browserWithCard();
    const response = await startAuthentication("revibase-signin:abc");

    const { publicKey } = get.mock.calls[0]![0];
    expect(bytes(publicKey!.allowCredentials![0]!.id)).toEqual(
      new TextEncoder().encode("authorizerevibase-signin:abc"),
    );
    expect(publicKey).toMatchObject({
      rpId: "shop.test",
      userVerification: "discouraged",
      extensions: { largeBlob: { read: true } },
    });
    expect(response.clientExtensionResults.largeBlob?.blob).toEqual(expect.any(String));
  });

  it("closes the prompt when its signal aborts, rejecting with the signal's reason", async () => {
    const get = browserWaitingForTap();
    const controller = new AbortController();
    const tap = startAuthentication("a", controller);
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(tap).rejects.toBe(controller.signal.reason);
    await expect(startAuthentication("a", { signal: controller.signal })).rejects.toBe(
      controller.signal.reason,
    );
  });

  it("a new tap closes a prompt left open, instead of failing as already pending", async () => {
    const get = browserWaitingForTap();
    const stale = startAuthentication("a");
    await Promise.resolve();
    const fresh = startAuthentication("b");
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    expect(get).toHaveBeenCalledTimes(2);
    void fresh.catch(() => {});
  });
});

describe("browserRpId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the page hostname in a browser, "" outside one', () => {
    expect(browserRpId()).toBe("");
    vi.stubGlobal("window", { location: { hostname: "shop.test" } });
    expect(browserRpId()).toBe("shop.test");
  });
});
