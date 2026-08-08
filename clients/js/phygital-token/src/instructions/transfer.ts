import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import { getExecuteTransferInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "./initialize.js";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  asset: Address;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the asset signature.
 * Must be followed promptly by {@link authenticatePasskeyForTransfer} and
 * {@link completeTransfer}.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  asset: Address;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    asset: input.asset,
    slotHash,
  });

  return {
    rpc: input.rpc,
    asset: input.asset,
    slotHash,
    slotNumber,
    challenge,
  };
}

/** Prompts the physical asset passkey (WebAuthn / NFC tap). */
export async function authenticatePasskeyForTransfer(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(
      bufferToBase64URLString(session.challenge),
    ),
  );
}

/**
 * Builds the two on-chain instructions after asset authentication.
 * Ownership is updated on the asset PDA only — no SPL token transfer.
 */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: Address,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      secp256r1PublicKey: parseSecp256r1Pubkey(response.id),
      existingSecp256r1VerifyInputs,
    });

  const executeTransfer = getExecuteTransferInstruction({
    recipient,
    asset: session.asset,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      slotNumber: session.slotNumber,
      clientDataJson,
    },
  });

  return [secp256r1Verify, executeTransfer];
}
