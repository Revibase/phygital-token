import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildTransferChallenge } from "../utils/passkey/secp256r1.js";

const addr = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("set_owner challenge", () => {
  it("matches the program's vector (programs/phygital-token/tests/set_owner_challenge.rs)", async () => {
    const challenge = await buildTransferChallenge({
      phygitalToken: addr(2),
      recipient: addr(4),
      slotHash: new Uint8Array(32).fill(3),
    });
    expect(hex(challenge)).toBe("eea8483ed6f4ff7a77be95ef7b2bb9f27b9a720e30afb1774afc1f5ccea1328b");
  });
});
