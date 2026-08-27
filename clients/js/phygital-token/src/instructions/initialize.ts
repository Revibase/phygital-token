import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getInitializeInstruction } from "../generated/instructions/initialize.js";
import type { PhygitalTokenType } from "../generated/types/phygitalTokenType.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { findTokenPda } from "../utils/pdas/token.js";

export {
  parseIdentifier,
  parseSecp256r1Pubkey,
} from "../utils/parseSecp256r1Pubkey.js";

export type InitializeParams = {
  authority: TransactionSigner;
  /** Physical chip id stored on the token for binding (not the PDA seed). */
  identifier: Secp256r1Pubkey;
  /** Passkey that seeds the token PDA and authorizes transfers. */
  secp256r1Pubkey: Secp256r1Pubkey;
  tokenType: PhygitalTokenType;
};

/**
 * Build the `initialize` instruction that creates a token PDA seeded by
 * `secp256r1Pubkey` and stores `identifier` as a binding field.
 *
 * `authority` must be the designated admin
 * (`G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF`). On mainnet that
 * address is a Squads vault — wrap this kit instruction with your own
 * Squads client if the vault must sign.
 */
export async function buildInitializeInstruction(
  input: InitializeParams,
): Promise<{ instruction: Instruction; token: Address }> {
  const token = await findTokenPda(input.secp256r1Pubkey);
  const instruction = getInitializeInstruction({
    authority: input.authority,
    token,
    identifier: input.identifier,
    secp256r1Pubkey: input.secp256r1Pubkey,
    tokenType: input.tokenType,
  });
  return { instruction, token };
}
