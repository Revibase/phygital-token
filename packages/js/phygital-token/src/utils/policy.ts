import type { Address } from "@solana/kit";
import {
  findPolicyPda,
  findWalletPda,
  PhygitalTokenType,
  type PhygitalToken,
} from "../generated/index.js";

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/**
 * Whether `set_owner` refuses the token: Controlled and Permanent tokens are
 * locked whenever they have an owner; Bearer tokens never are.
 */
export function isPhygitalTokenLocked(token: Pick<PhygitalToken, "tokenType" | "owner">): boolean {
  const bearer: number = PhygitalTokenType.Bearer;
  return token.tokenType !== bearer && token.owner !== DEFAULT_PUBKEY;
}

/**
 * The `policy` / `wallet` accounts `set_owner` and `remove_owner` take: an
 * owner change closes the token's accessory policy, and its rent always
 * returns to the accessory wallet.
 */
export async function getPolicyCloseAccounts(
  phygitalToken: Address,
): Promise<{ policy: Address; wallet: Address }> {
  const [[policy], [wallet]] = await Promise.all([
    findPolicyPda({ phygitalToken }),
    findWalletPda({ phygitalToken }),
  ]);
  return { policy, wallet };
}
