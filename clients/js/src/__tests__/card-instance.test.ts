import { address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  getCardInstanceEncoder,
  CARD_INSTANCE_DISCRIMINATOR,
} from "../generated/accounts/cardInstance";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../generated/programs/phygitalNfts";
import { parseCardInstanceAccount } from "../utils/metadata";

describe("parseCardInstanceAccount", () => {
  it("parses owner and design mint from encoded account data", async () => {
    const cardInstance = address("11111111111111111111111111111112");
    const designMint = address("11111111111111111111111111111113");
    const owner = address("11111111111111111111111111111114");
    const uri = "https://example.com/card.json";
    const lastTransferSlot = 42n;

    const body = getCardInstanceEncoder().encode({
      uri,
      designMint,
      owner,
      lastTransferSlot,
    });
    const data = new Uint8Array(body);

    const rpc = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            owner: PHYGITAL_NFTS_PROGRAM_ADDRESS,
            data: [Buffer.from(data).toString("base64"), "base64"],
            lamports: 1n,
            executable: false,
            rentEpoch: 0n,
            space: BigInt(data.length),
          },
        }),
      }),
    } as unknown as Rpc<SolanaRpcApi>;

    const parsed = await parseCardInstanceAccount(rpc, cardInstance);
    expect(parsed.uri).toBe(uri);
    expect(parsed.designMint).toBe(designMint);
    expect(parsed.owner).toBe(owner);
    expect(parsed.lastTransferSlot).toBe(lastTransferSlot);
    expect(data.subarray(0, 8)).toEqual(CARD_INSTANCE_DISCRIMINATOR);
  });
});
