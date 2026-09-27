import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Rpc, SolanaRpcApi } from "@solana/kit";

vi.mock("../utils/passkey/nfc/index.js", () => ({
  authenticateWithApdu: vi.fn(async () => ({ id: "apdu-response" })),
}));

vi.mock("../utils/passkey/webauthn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/passkey/webauthn.js")>();
  return {
    ...actual,
    authenticateWithWebauthn: vi.fn(async () => ({ id: "webauthn-response" })),
  };
});

import { authenticateWithApdu } from "../utils/passkey/nfc/index.js";
import {
  authenticateWithWebauthn,
  bufferToBase64URLString,
} from "../utils/passkey/webauthn.js";
import { authenticatePasskey } from "../utils/passkey/authenticate.js";

const rpc = {} as Rpc<SolanaRpcApi>;
const challenge = bufferToBase64URLString(new Uint8Array(32).fill(7));

describe("authenticatePasskey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { hostname: "example.test" } });
  });

  it("uses authenticateWithApdu when transceive is provided", async () => {
    const transceive = vi.fn(async (apdu: Uint8Array) => apdu);
    const result = await authenticatePasskey(challenge, rpc, { transceive });

    expect(result).toEqual({ id: "apdu-response" });
    expect(authenticateWithApdu).toHaveBeenCalledTimes(1);
    expect(authenticateWithApdu).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge,
        rpId: "",
        origin: "",
        userVerification: "preferred",
        allowCredentials: [
          {
            id: "",
            type: "public-key",
            transports: ["nfc"],
          },
        ],
      }),
      transceive,
    );
    expect(authenticateWithWebauthn).not.toHaveBeenCalled();
  });

  it("uses authenticateWithWebauthn when transceive is omitted", async () => {
    const result = await authenticatePasskey(challenge, rpc, {
      rpId: "app.example",
      credentialId: "cred",
    });

    expect(result).toEqual({ id: "webauthn-response" });
    expect(authenticateWithWebauthn).toHaveBeenCalledTimes(1);
    expect(authenticateWithApdu).not.toHaveBeenCalled();
    const [options, passedRpc] = vi.mocked(authenticateWithWebauthn).mock.calls[0]!;
    expect(passedRpc).toBe(rpc);
    expect(options.challenge).toBe(challenge);
    expect(options.rpId).toBe("app.example");
    expect(options.allowCredentials?.[0]?.id).toBe("cred");
  });
});
