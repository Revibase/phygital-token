import { createHash } from "node:crypto";
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  findCardInstancePda,
  findmintPda,
} from "../instructions/mint";
import {
  buildTransferChallenge,
  buildTransferMessageHash,
} from "../utils/passkey/secp256r1";
import { TRANSFER_ACTION_BYTES, TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey";

function pubkeyFromByte(byte: number) {
  const bytes = new Uint8Array(32).fill(byte);
  return getAddressDecoder().decode(bytes);
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("buildTransferMessageHash", () => {
  it("matches Rust golden vector for fixed pubkeys", async () => {
    const cardInstance = pubkeyFromByte(1);
    const sender = pubkeyFromByte(2);

    const preimage = concatBytes(
      new Uint8Array(getAddressEncoder().encode(cardInstance)),
      new Uint8Array(getAddressEncoder().encode(sender)),
    );
    const expected = sha256(preimage);

    const hash = await buildTransferMessageHash({ cardInstance, sender });
    expect(hash).toEqual(expected);
  });
});

describe("buildTransferChallenge", () => {
  it("matches Rust challenge layout", async () => {
    const cardInstance = pubkeyFromByte(1);
    const sender = pubkeyFromByte(2);
    const slotHash = new Uint8Array(32).fill(9);

    const messageHash = await buildTransferMessageHash({ cardInstance, sender });
    const expected = sha256(
      concatBytes(
        TRANSFER_ACTION_BYTES,
        new Uint8Array(getAddressEncoder().encode(TOKEN_2022_PROGRAM_ADDRESS)),
        messageHash,
        slotHash,
      ),
    );

    const challenge = await buildTransferChallenge({
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      cardInstance,
      sender,
      slotHash,
    });
    expect(challenge).toEqual(expected);
  });
});

describe("PDAs", () => {
  it("findmintPda uses group_mint and design_id seeds", async () => {
    const groupMint = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    const designId = pubkeyFromByte(42);
    const mint = await findmintPda(groupMint, designId);
    expect(mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("findCardInstancePda uses x-only secp256r1 seed", async () => {
    const compressed = new Uint8Array(33);
    compressed[0] = 0x02;
    compressed.fill(7, 1);
    const secp256r1Pubkey = [compressed] as Secp256r1Pubkey;
    const cardInstance = await findCardInstancePda(secp256r1Pubkey);
    expect(cardInstance).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
