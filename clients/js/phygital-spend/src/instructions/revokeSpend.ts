import {
  getRevokeInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import type { Address, TransactionSigner } from "@solana/kit";

export type RevokeSpendInput = {
  /** Owner of the token account; must sign the revoke. */
  owner: TransactionSigner;
  /** The token account whose delegate (the spend authority) is being cleared. */
  ownerTokenAccount: Address;
  /** Token program owning `ownerTokenAccount`. Defaults to Token-2022. */
  tokenProgram?: Address;
};

/**
 * Builds an SPL `revoke` instruction that clears the delegate (the spend authority) on
 * `ownerTokenAccount`, ending the owner's spending allowance.
 */
export async function getRevokeSpendInstruction(input: RevokeSpendInput) {
  return getRevokeInstruction(
    {
      source: input.ownerTokenAccount,
      owner: input.owner,
    },
    { programAddress: input.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS },
  );
}
