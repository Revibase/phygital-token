import { type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { getSetMintInstruction } from "../generated/instructions/setMint.js";

export type SetMintParams = {
  /** Defaults to the designated admin if omitted. */
  authority?: TransactionSigner;
  token: Address;
  mint: Address;
};

/** Build the `set_mint` instruction that binds an SPL mint to a token PDA. */
export function buildSetMintInstruction(input: SetMintParams): Instruction {
  return getSetMintInstruction({
    authority: input.authority,
    token: input.token,
    mint: input.mint,
  });
}
