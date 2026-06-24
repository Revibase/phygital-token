import {
  getApproveCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import type { Address, TransactionSigner } from "@solana/kit";

import { findSpendAuthorityPda } from "../generated/index.js";

export type ApproveSpendInput = {
  /** Owner of the token account; must sign the approval. */
  owner: TransactionSigner;
  /** The owner's token account holding the spend token (e.g. their USDC ATA). */
  ownerTokenAccount: Address;
  /** The spend token mint. */
  mint: Address;
  /** The phygital-token asset whose per-asset spend authority is being funded. */
  asset: Address;
  /** Amount, in base units, to delegate. */
  amount: bigint | number;
  /** Decimals of `mint` (used by `approveChecked`). */
  decimals: number;
  /** Token program owning `mint` / `ownerTokenAccount`. Defaults to Token-2022. */
  tokenProgram?: Address;
};

/**
 * Builds an SPL `approveChecked` instruction that delegates the asset's per-asset `spend_authority`
 * PDA (under the phygital-spend program) as the delegate on `ownerTokenAccount`. After this,
 * passkey-gated `executeSpend` calls can pull up to `amount` from the owner's wallet.
 */
export async function getApproveSpendInstruction(input: ApproveSpendInput) {
  const [spendAuthority] = await findSpendAuthorityPda({ asset: input.asset });
  return getApproveCheckedInstruction(
    {
      source: input.ownerTokenAccount,
      mint: input.mint,
      delegate: spendAuthority,
      owner: input.owner,
      amount: input.amount,
      decimals: input.decimals,
    },
    { programAddress: input.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS },
  );
}