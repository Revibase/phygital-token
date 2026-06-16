import type { Address, Instruction } from "@solana/kit";
import { getUpdateCounterInstruction } from "../generated";
import { buildTapVerifyInstruction } from "./transfer";

/**
 * Builds the `[secp256r1Verify, updateCounter]` instruction pair that syncs the card's
 * on-chain counter to a freshly tapped URL, without transferring the card.
 *
 * Off-chain verification advances the physical tag counter while the chain stays put, so
 * the on-chain counter drifts behind and old captured taps could still be replayed. Call
 * this with the latest tap to close that gap and invalidate every earlier URL. It is
 * permissionless — whoever submits the transaction pays the fee.
 */

export async function buildUpdateCounterInstructions(input: {
  params: URLSearchParams;
  cardInstance: Address;
}): Promise<Instruction[]> {
  const secp256r1Verify = await buildTapVerifyInstruction(
    input.params,
    input.cardInstance
  );

  const updateCounter = getUpdateCounterInstruction({
    cardInstance: input.cardInstance,
    secp256r1VerifyArgs: { instructionIndex: 0, signedMessageIndex: 0 },
  });

  return [secp256r1Verify, updateCounter];
}
