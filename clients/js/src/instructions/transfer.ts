import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import { resolveTransferMintContext } from "../utils/metadata";
import {
  authenticateTransferPasskey,
  buildTransferInstructions,
} from "../utils/passkey/internal";
import { buildTransferChallenge } from "../utils/passkey/secp256r1";
import { getLatestSlotHash } from "../utils/slotHash";
import { getCurrentOwner } from "../utils/tokenOwner";

export type TransferInput = {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
  recipient: TransactionSigner;
};

/**
 * Prompts the NFT owner's passkey and returns the two instructions required for
 * a transfer: secp256r1 verification followed by `execute_transfer`.
 */
export async function transfer(input: TransferInput): Promise<Instruction[]> {
  const currentOwner = await getCurrentOwner(input.rpc, input.mint);
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    mint: input.mint,
    sender: currentOwner,
    recipient: input.recipient.address,
    slotHash,
  });

  const mintContext = await resolveTransferMintContext(input.rpc, input.mint);
  const webauthnResponse = await authenticateTransferPasskey({
    challenge,
    secp256r1Pubkey: mintContext.secp256r1Pubkey,
  });

  return buildTransferInstructions({
    ...input,
    currentOwner,
    mintContext,
    webauthnResponse,
    slotNumber,
  });
}
