import { address, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  fetchCardInstance,
  getCardInstanceEncoder,
  CARD_INSTANCE_DISCRIMINATOR,
} from "../generated/accounts/cardInstance";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../generated/programs/phygitalNfts";

describe("fetchCardInstance", () => {
  it("decodes owner and design mint from encoded account data", async () => {
    const cardInstance = address("11111111111111111111111111111112");
    const mint = address("11111111111111111111111111111113");
    const owner = address("11111111111111111111111111111114");
    const lastTransferSlot = 42n;

    const body = getCardInstanceEncoder().encode({
      mint,
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

    const parsed = await fetchCardInstance(rpc, cardInstance);
    expect(parsed.data.mint).toBe(mint);
    expect(parsed.data.owner).toBe(owner);
    expect(parsed.data.lastTransferSlot).toBe(lastTransferSlot);
    expect(data.subarray(0, 8)).toEqual(CARD_INSTANCE_DISCRIMINATOR);
  });
});
