import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import {
  resolveTokenJsonMetadata,
  resolveTransferMintContext,
  type TransferMintContext,
} from "../utils/metadata";
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

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
  currentOwner: Address;
  mintContext: TransferMintContext;
  credentialId: string | null;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
};

export type BeginTransferInput = {
  rpc: Rpc<SolanaRpcApi>;
  mint: Address;
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the card signature.
 * Must be followed promptly by authenticateCard and completeTransfer.
 */
export async function beginTransfer(
  input: BeginTransferInput,
): Promise<TransferSession> {
  const currentOwner = await getCurrentOwner(input.rpc, input.mint);
  const [mintContext, jsonMeta] = await Promise.all([
    resolveTransferMintContext(input.rpc, input.mint),
    resolveTokenJsonMetadata(input.rpc, input.mint),
  ]);
  const credentialId = jsonMeta?.credentialId?.trim() || null;
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    mint: input.mint,
    sender: currentOwner,
    slotHash,
  });

  return {
    rpc: input.rpc,
    mint: input.mint,
    currentOwner,
    mintContext,
    credentialId,
    slotHash,
    slotNumber,
    challenge,
  };
}

/**
 * Prompts the physical card passkey (WebAuthn / NFC tap).
 */
export async function authenticateCard(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateTransferPasskey(session.challenge, session.credentialId);
}

/**
 * Builds the two on-chain instructions after card authentication.
 */
export async function completeTransfer(
  session: TransferSession,
  webauthnResponse: AuthenticationResponseJSON,
  recipient: TransactionSigner,
): Promise<Instruction[]> {
  return buildTransferInstructions({
    rpc: session.rpc,
    mint: session.mint,
    recipient,
    currentOwner: session.currentOwner,
    mintContext: session.mintContext,
    webauthnResponse,
    slotNumber: session.slotNumber,
  });
}

