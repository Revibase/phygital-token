import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateWithWebauthn, bufferToBase64URLString } from "../utils/passkey/webauthn.js";

const options = {
  challenge: bufferToBase64URLString(new Uint8Array(32).fill(7)),
  rpId: "app.example",
  allowCredentials: [],
};

/** Like a browser: one prompt at a time, which waits for a tap that never comes until its signal aborts. */
function browser() {
  let pending = false;
  const get = vi.fn(({ signal }: { signal?: AbortSignal }) => {
    if (pending) return Promise.reject(new DOMException("A request is already pending.", "NotAllowedError"));
    pending = true;
    return new Promise((_, reject) =>
      signal?.addEventListener("abort", () => {
        pending = false;
        reject(signal.reason);
      }),
    );
  });
  vi.stubGlobal("window", { PublicKeyCredential: function () {} });
  vi.stubGlobal("navigator", { credentials: { get } });
  return get;
}

describe("authenticateWithWebauthn", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("cancels the prompt when its signal aborts, so the next tap can prompt again", async () => {
    const get = browser();
    const first = new AbortController();
    const tap = authenticateWithWebauthn(options, first.signal);
    expect(get.mock.calls[0]![0]).toMatchObject({ signal: first.signal });
    first.abort();
    await expect(tap).rejects.toMatchObject({ name: "AbortError" });

    const second = new AbortController();
    const again = authenticateWithWebauthn(options, second.signal);
    expect(get).toHaveBeenCalledTimes(2);
    second.abort();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
  });

  it("without a signal, a prompt left open blocks the next one", async () => {
    browser();
    void authenticateWithWebauthn(options).catch(() => {});
    await expect(authenticateWithWebauthn(options)).rejects.toMatchObject({ code: "AUTHENTICATION_CANCELLED" });
  });
});
