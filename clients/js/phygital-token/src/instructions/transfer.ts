import {
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts.js";
import { type AssetDisplayInfo } from "../utils/metadata.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import {
  getExecuteTransferInstructionAsync,
} from "../generated/index.js";
import { findAssociatedTokenAddress } from "../utils/associatedToken.js";
import { parseSecp256r1Pubkey } from "./mint.js";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  displayInfo: AssetDisplayInfo;
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
  displayInfo: AssetDisplayInfo;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    asset: input.displayInfo.asset,
    slotHash,
  });

  return {
    rpc: input.rpc,
    displayInfo: input.displayInfo,
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
      session.displayInfo.secp256r1PublicKey,
    ),
  );
}

/** Builds the two on-chain instructions after asset authentication. */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: TransactionSigner,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;

  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      secp256r1PublicKey: parseSecp256r1Pubkey(
        session.displayInfo.secp256r1PublicKey,
      ),
      existingSecp256r1VerifyInputs,
    });

  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipient.address,
    session.displayInfo.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    session.displayInfo.currentOwner,
    session.displayInfo.mint,
    tokenProgram,
  );

  const executeTransfer = await getExecuteTransferInstructionAsync({
    recipient,
    sender: session.displayInfo.currentOwner,
    asset: session.displayInfo.asset,
    mint: session.displayInfo.mint,
    senderTokenAccount,
    recipientTokenAccount,
    tokenProgram,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      slotNumber: session.slotNumber,
      clientDataJson,
    },
  });

  return [secp256r1Verify, executeTransfer];
}
