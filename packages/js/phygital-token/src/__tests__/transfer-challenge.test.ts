import { createNoopSigner, getAddressDecoder, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { completeTransfer, type TransferSession } from "../instructions/transfer.js";
import { buildTransferChallenge } from "../utils/passkey/secp256r1.js";
import type { AuthenticationResponseJSON } from "../utils/passkey/webauthn.js";

const addr = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("set_owner challenge", () => {
  it("matches the program's vector (programs/phygital-token/tests/set_owner_challenge.rs)", async () => {
    const challenge = await buildTransferChallenge({
      phygitalToken: addr(2),
      slotHash: new Uint8Array(32).fill(3),
      recipient: addr(4),
    });
    expect(hex(challenge)).toBe("8c13df6d7fdfa2ddff077c0a9627bfe8d193d362549856bc1d34e1b9617cd2ab");
  });

  it("names the recipient", async () => {
    const base = { phygitalToken: addr(2), slotHash: new Uint8Array(32).fill(3) };
    const a = await buildTransferChallenge({ ...base, recipient: addr(4) });
    const b = await buildTransferChallenge({ ...base, recipient: addr(5) });
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe("completeTransfer", () => {
  it("refuses a signer other than the session's recipient", async () => {
    const session: TransferSession = {
      rpc: {} as Rpc<SolanaRpcApi>,
      phygitalToken: addr(2),
      secp256r1Pubkey: "",
      slotHash: new Uint8Array(32),
      slotNumber: 1n,
      recipient: addr(4),
      challenge: new Uint8Array(32),
      rpId: "example.com",
    };
    await expect(
      completeTransfer(session, {} as AuthenticationResponseJSON, createNoopSigner(addr(5))),
    ).rejects.toMatchObject({ code: "RECIPIENT_MISMATCH" });
  });
});
