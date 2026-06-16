import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  TRANSFER_HOOK_PROGRAM_ADDRESS,
} from "../utils/consts";
import { findAssociatedTokenAddress } from "../utils/associatedToken";
import {
  getExecuteTransferInstructionAsync,
} from "../generated";
import { getSecp256r1VerifyInstruction } from "./internal/secp256r1Verify";
import { parseTapSignature } from "../utils/verify";
import { findCardInstancePda, parseSecp256r1Pubkey } from "./mint";

/**
 * Builds the secp256r1 precompile instruction that verifies a tapped NDEF dynamic URL,
 * after checking the signing key is the one bound to `cardInstance`.
 */
export async function buildTapVerifyInstruction(
  params: URLSearchParams,
  cardInstance: Address,
): Promise<Instruction> {
  const tap = parseTapSignature(params);

  const publicKey = params.get("pk")!;
  const secp256r1Pubkey = parseSecp256r1Pubkey(publicKey);
  const expectedCardInstance = await findCardInstancePda(secp256r1Pubkey);
  if (expectedCardInstance !== cardInstance) {
    throw new Error("Tag public key does not match this card instance");
  }

  return getSecp256r1VerifyInstruction([
    {
      publicKey: tap.compressedPubkey,
      signature: tap.signature,
      message: tap.message,
    },
  ]);
}

/** Minimal card identity needed to build a transfer from a dynamic-URL tap. */
export type TapTransferTarget = {
  /** Card instance PDA — unique per physical card. */
  cardInstance: Address;
  /** Shared design mint (SFT). */
  mint: Address;
  /** Current on-chain owner (the sender; does not sign). */
  currentOwner: Address;
};

/**
 * Builds the `[secp256r1Verify, executeTransfer]` instruction pair from a tapped NDEF
 * dynamic URL. The tag's signature over `counter || nonce` is verified by the secp256r1
 * precompile; the program then enforces card identity (pubkey → PDA) and counter
 * monotonicity. The recipient is chosen here — it is not part of the signed message, so
 * whoever submits the transaction claims the card.
 */
export async function buildTapTransferInstructions(input: {
  params: URLSearchParams;
  nft: TapTransferTarget;
  recipient: TransactionSigner;
}): Promise<Instruction[]> {
  const { params, nft, recipient } = input;
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;

  const secp256r1Verify = await buildTapVerifyInstruction(
    params,
    nft.cardInstance,
  );

  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipient.address,
    nft.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    nft.currentOwner,
    nft.mint,
    tokenProgram,
  );

  const executeTransfer = await getExecuteTransferInstructionAsync({
    recipient,
    sender: nft.currentOwner,
    cardInstance: nft.cardInstance,
    mint: nft.mint,
    senderTokenAccount,
    recipientTokenAccount,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ADDRESS,
    tokenProgram,
    secp256r1VerifyArgs: {instructionIndex:0, signedMessageIndex: 0 },
  });

  return [secp256r1Verify, executeTransfer];
}


