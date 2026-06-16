import {
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import { type NftDisplayInfo } from "../utils/metadata";
import {
  authenticateTransferPasskey,
  buildTransferInstructions,
} from "../utils/passkey/internal";
import { buildTransferChallenge } from "../utils/passkey/secp256r1";
import { getLatestSlotHash } from "../utils/slotHash";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  nft: NftDisplayInfo;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the card signature.
 * Must be followed promptly by authenticateCard and completeTransfer.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  nft: NftDisplayInfo;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    cardInstance: input.nft.cardInstance,
    sender: input.nft.currentOwner,
    slotHash,
  });

  return {
    rpc: input.rpc,
    nft: input.nft,
    slotHash,
    slotNumber,
    challenge,
  };
}

/** Prompts the physical card passkey (WebAuthn / NFC tap). */
export async function authenticateCard(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateTransferPasskey(session.challenge);
}

/** Builds the two on-chain instructions after card authentication. */
export async function completeTransfer(
  session: TransferSession,
  webauthnResponse: AuthenticationResponseJSON,
  recipient: TransactionSigner,
): Promise<Instruction[]> {
  return buildTransferInstructions(session, webauthnResponse, recipient);
}
