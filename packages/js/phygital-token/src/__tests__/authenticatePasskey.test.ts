import { describe, expect, it, vi, beforeEach } from "vitest";

const { CRED } = vi.hoisted(() => ({
  CRED: Buffer.from(new Uint8Array(33).fill(2)).toString("base64url"),
}));

vi.mock("../utils/passkey/webauthn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/passkey/webauthn.js")>();
  return {
    ...actual,
    authenticateWithWebauthn: vi.fn(async () => ({ id: CRED, rawId: CRED })),
  };
});

import { authenticateWithWebauthn, bufferToBase64URLString } from "../utils/passkey/webauthn.js";
import { authenticatePasskey } from "../utils/passkey/authenticate.js";

const allowList = new Set([CRED]);
const OTHER = Buffer.from(new Uint8Array(33).fill(3)).toString("base64url");
const challenge = bufferToBase64URLString(new Uint8Array(32).fill(7));

describe("authenticatePasskey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { hostname: "example.test" } });
  });

  it("prompts browser WebAuthn with the given rpId and credential", async () => {
    const result = await authenticatePasskey(challenge, {
      allowList,
      rpId: "app.example",
      credentialId: "cred",
    });

    expect(result.id).toBe(CRED);
    expect(authenticateWithWebauthn).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(authenticateWithWebauthn).mock.calls[0]!;
    expect(options.challenge).toBe(challenge);
    expect(options.rpId).toBe("app.example");
    expect(options.allowCredentials?.[0]?.id).toBe("cred");
  });

  it("rejects a credential id outside the allowList", async () => {
    vi.mocked(authenticateWithWebauthn).mockResolvedValueOnce({
      id: OTHER,
      rawId: OTHER,
    } as never);
    await expect(
      authenticatePasskey(challenge, { allowList, rpId: "app.example" }),
    ).rejects.toMatchObject({ code: "PASSKEY_NOT_RECOGNIZED" });
  });

  it("passes its signal to the WebAuthn prompt", async () => {
    const controller = new AbortController();
    await authenticatePasskey(challenge, { allowList, rpId: "app.example", signal: controller.signal });
    expect(vi.mocked(authenticateWithWebauthn).mock.calls[0]![1]).toBe(controller.signal);
  });
});
