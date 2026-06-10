import {
  getAddressDecoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { fetchAccountData } from "./slotHash";

const TOKEN_ACCOUNT_OWNER_OFFSET = 32;
const TOKEN_ACCOUNT_OWNER_SIZE = 32;

/**
 * Returns the wallet that currently holds the NFT (amount === 1).
 * Uses `getTokenLargestAccounts` then reads the owner field from the token account.
 */
export async function getCurrentOwner(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<Address> {
  const largestAccounts = (
    await rpc
      .getTokenLargestAccounts(mint, { commitment: "confirmed" })
      .send()
  ).value;

  if (!largestAccounts?.length) {
    throw new Error(`No token accounts found for mint ${mint}`);
  }

  const holderEntry =
    largestAccounts.find((entry) => entry.amount === "1") ??
    largestAccounts.find((entry) => entry.amount !== "0");

  if (!holderEntry) {
    throw new Error(`No current holder found for mint ${mint}`);
  }

  const tokenAccountData = await fetchAccountData(rpc, holderEntry.address);
  return getAddressDecoder().decode(
    tokenAccountData.subarray(
      TOKEN_ACCOUNT_OWNER_OFFSET,
      TOKEN_ACCOUNT_OWNER_OFFSET + TOKEN_ACCOUNT_OWNER_SIZE,
    ),
  );
}
