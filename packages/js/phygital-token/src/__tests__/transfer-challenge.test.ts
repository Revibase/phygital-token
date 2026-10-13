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
      slotHash: new Uint8Array(32).fill(3),
    });
    expect(hex(challenge)).toBe("8fd09e40a624648512d2a9307debc39c1aa1125ace30757203dd252c8f07b9b0");
  });
});
