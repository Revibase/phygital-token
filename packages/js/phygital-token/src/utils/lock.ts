import { PhygitalTokenType, type PhygitalToken } from "../generated/index.js";

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/**
 * Whether `set_owner` refuses the token: Controlled and Permanent tokens are
 * locked whenever they have an owner; Bearer tokens never are.
 */
export function isPhygitalTokenLocked(token: Pick<PhygitalToken, "tokenType" | "owner">): boolean {
  const bearer: number = PhygitalTokenType.Bearer;
  return token.tokenType !== bearer && token.owner !== DEFAULT_PUBKEY;
}
