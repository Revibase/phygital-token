import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getSetTransferConfigInstructionAsync } from "../generated";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";

export type SetTransferConfigParams = {
  /** Sale price in lamports (native SOL) or smallest units of `paymentTokenMint`. */
  price: bigint | number;
  /** SPL mint used for payment. Omit or `null` to charge native SOL. */
  paymentTokenMint?: Address | null;
  /** Restrict transfers to this wallet. Omit or `null` to allow any recipient. */
  allowedRecipient?: Address | null;
};

export type ConfigureTransferInput = {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
  /** Must be the wallet that currently holds the NFT. */
  owner: TransactionSigner;
  /** Pays rent if the mint account must grow. Defaults to `owner`. */
  payer?: TransactionSigner;
} & SetTransferConfigParams;

/**
 * Builds a `set_transfer_config` instruction for an NFT the owner currently holds.
 * Resolves the owner token ATA and program authority automatically.
 */
export async function setTransferConfig(
  input: ConfigureTransferInput,
): Promise<Instruction> {

  const payer = input.payer ?? input.owner;

  return getSetTransferConfigInstructionAsync({
    payer,
    owner: input.owner,
    tokenMint: input.mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    price: input.price,
    paymentTokenMint: input.paymentTokenMint ?? null,
    allowedRecipient: input.allowedRecipient ?? null,
  });
}
