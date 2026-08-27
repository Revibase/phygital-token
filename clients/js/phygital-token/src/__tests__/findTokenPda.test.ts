import { describe, expect, it } from "vitest";
import { findPhygitalTokenPda } from "../utils/pdas/token.js";
import { parseSecp256r1Pubkey } from "../utils/parseSecp256r1Pubkey.js";
import { bufferToBase64URLString } from "../utils/passkey/webauthn.js";

function compressedPubkeyString(prefix: 0x02 | 0x03 = 0x02): string {
  const bytes = new Uint8Array(33);
  bytes[0] = prefix;
  bytes.set(
    Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    1,
  );
  return bufferToBase64URLString(bytes);
}

describe("findPhygitalTokenPda", () => {
  it("accepts a base64url string and a parsed pubkey and derives the same PDA", async () => {
    const encoded = compressedPubkeyString();
    const fromString = await findPhygitalTokenPda(encoded);
    const fromParsed = await findPhygitalTokenPda(parseSecp256r1Pubkey(encoded));
    expect(fromString).toBe(fromParsed);
  });

  it("rejects an invalid secp256r1 public key string", async () => {
    await expect(findPhygitalTokenPda("not-a-key")).rejects.toThrow(
      /33 bytes|base64url|compressed/,
    );
  });
});
