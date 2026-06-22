import {
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  startAuthentication,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts.js";
import { type AssetDisplayInfo } from "../utils/metadata.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import { getExecuteTransferInstructionAsync } from "../generated/index.js";
import { findAssociatedTokenAddress } from "../utils/associatedToken.js";

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
 * Must be followed promptly by authenticateToken and completeTransfer.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  displayInfo: AssetDisplayInfo;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    sender: input.displayInfo.currentOwner,
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
export async function authenticateToken(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(session.challenge).buffer as ArrayBuffer,
      ),
      rpId: window.location.hostname,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: session.displayInfo.credentialId,
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

/** Builds the two on-chain instructions after asset authentication. */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: TransactionSigner,
): Promise<Instruction[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;

  const { secp256r1Verify, origin, crossOrigin, truncatedClientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      publicKey: session.displayInfo.publicKey,
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
      signedMessageIndex: 0,
      slotNumber: session.slotNumber,
      origin,
      crossOrigin,
      truncatedClientDataJson,
    },
  });

  return [secp256r1Verify, executeTransfer];
}
