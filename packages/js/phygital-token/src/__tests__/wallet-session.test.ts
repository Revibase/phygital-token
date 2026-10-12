import {
  address,
  getBase64Decoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  findPolicyPda,
  getAccessoryPolicyEncoder,
  getPhygitalTokenEncoder,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../generated/index.js";
import { resolveWalletSession } from "../wallet-standard/session.js";

const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const OWNER = address("SysvarC1ock11111111111111111111111111111111");
const WALLET = address("So11111111111111111111111111111111111111112");
const DEFAULT = address("11111111111111111111111111111111");

/** RPC serving `accounts` (program-owned) for `getAccountInfo`. */
function rpcWith(accounts: Map<Address, Uint8Array>): Rpc<SolanaRpcApi> {
  return {
    getAccountInfo: (key: Address) => ({
      send: async () => {
        const data = accounts.get(key);
        return {
          value: data && {
            data: [getBase64Decoder().decode(data), "base64"],
            executable: false,
            lamports: 1_000_000n,
            owner: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
            space: BigInt(data.length),
          },
        };
      },
    }),
  } as unknown as Rpc<SolanaRpcApi>;
}

function token(owner: Address): Uint8Array {
  return new Uint8Array(
    getPhygitalTokenEncoder().encode({
      owner,
      mint: DEFAULT,
      lastSignCount: 0,
      tokenType: 1,
      walletBump: 255,
      publicKey: [new Uint8Array(33)],
      identifier: [new Uint8Array(33)],
    })
  );
}

async function withPolicy(owner: Address): Promise<Map<Address, Uint8Array>> {
  const [policy] = await findPolicyPda({ phygitalToken: TOKEN });
  return new Map([
    [TOKEN, token(owner)],
    [
      policy,
      new Uint8Array(
        getAccessoryPolicyEncoder().encode({
          payer: OWNER,
          phygitalToken: TOKEN,
          wallet: WALLET,
          solCap: null,
          mintCaps: [],
          allowedOrigins: [],
          programPermissions: [],
        })
      ),
    ],
  ]);
}

describe("resolveWalletSession", () => {
  it("returns the policy's wallet and the token's owner", async () => {
    const session = await resolveWalletSession(rpcWith(await withPolicy(OWNER)), TOKEN);
    expect(session).toEqual({ phygitalTokenPda: TOKEN, walletPda: WALLET, owner: OWNER });
  });

  it("refuses a token without an accessory policy", async () => {
    await expect(
      resolveWalletSession(rpcWith(new Map([[TOKEN, token(OWNER)]])), TOKEN)
    ).rejects.toThrow(/has not set an accessory policy/);
  });

  it("refuses a token without an owner", async () => {
    await expect(
      resolveWalletSession(rpcWith(await withPolicy(DEFAULT)), TOKEN)
    ).rejects.toThrow(/has no owner/);
  });
});
