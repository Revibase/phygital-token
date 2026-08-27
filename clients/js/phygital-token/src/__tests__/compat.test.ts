import { describe, expect, it } from "vitest";
import { AccountRole, address, type Instruction } from "@solana/kit";
import {
  toAddress,
  toRpc,
  toTransactionSigner,
  toWeb3Instruction,
} from "../utils/compat.js";

const SAMPLE = "G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF";

describe("web3.js duck-type compat", () => {
  it("toAddress accepts a string and a PublicKey-like object", () => {
    const fromString = toAddress(SAMPLE);
    const fromPublicKey = toAddress({ toBase58: () => SAMPLE });
    expect(fromString).toBe(SAMPLE);
    expect(fromPublicKey).toBe(SAMPLE);
  });

  it("toRpc wraps a Connection-like object and leaves a Kit Rpc unchanged", () => {
    const fromUrl = toRpc("https://api.devnet.solana.com");
    expect(typeof fromUrl.getSlot).toBe("function");
    expect("send" in fromUrl.getSlot()).toBe(true);

    const fromConnection = toRpc({
      rpcEndpoint: "https://api.devnet.solana.com",
    });
    expect(typeof fromConnection.getSlot).toBe("function");

    const kitRpc = fromUrl;
    expect(toRpc(kitRpc)).toBe(kitRpc);
  });

  it("toTransactionSigner accepts Keypair-like { publicKey } as a no-op signer", () => {
    const signer = toTransactionSigner({
      publicKey: { toBase58: () => SAMPLE },
    });
    expect(signer.address).toBe(SAMPLE);
    expect("signTransactions" in signer).toBe(true);
  });

  it("toWeb3Instruction maps Kit accounts into web3.js keys", () => {
    const instruction: Instruction = {
      programAddress: address("11111111111111111111111111111111"),
      accounts: [
        {
          address: address(SAMPLE),
          role: AccountRole.WRITABLE_SIGNER,
        },
        {
          address: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          role: AccountRole.READONLY,
        },
      ],
      data: new Uint8Array([1, 2, 3]),
    };

    const web3Ix = toWeb3Instruction(instruction);
    expect(web3Ix.programId.toBase58()).toBe("11111111111111111111111111111111");
    expect(web3Ix.keys).toHaveLength(2);
    expect(web3Ix.keys[0]?.isSigner).toBe(true);
    expect(web3Ix.keys[0]?.isWritable).toBe(true);
    expect(web3Ix.keys[1]?.isSigner).toBe(false);
    expect(web3Ix.keys[1]?.isWritable).toBe(false);
    expect(Array.from(web3Ix.data)).toEqual([1, 2, 3]);
    expect(web3Ix.keys[0]?.pubkey.equals(SAMPLE)).toBe(true);
  });
});
