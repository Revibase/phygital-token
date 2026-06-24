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
  recipient: TransactionSigner,
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the asset signature.
 * Must be followed promptly by authenticateToken and completeTransfer.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  displayInfo: AssetDisplayInfo;
  recipient: TransactionSigner;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    recipient: input.recipient.address,
    slotHash,
  });

  return {
    rpc: input.rpc,
    displayInfo: input.displayInfo,
    slotHash,
    slotNumber,
    challenge,
    recipient: input.recipient,
  };
}

/**
 * Discoverable passkey tap — the credential id is returned in the response
 * and can be resolved on-chain via `fetchAssetCredentialFromCredentialId`.
 */
export async function authenticateDiscoverablePasskey(input: {
  challenge: Uint8Array;
}): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(input.challenge).buffer as ArrayBuffer,
      ),
      rpId: window.location.hostname,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: "",
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

/** Prompts the physical asset passkey (WebAuthn / NFC tap). */
export async function authenticatePasskey(input: {
  challenge: Uint8Array;
  credentialId: string;
}): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(input.challenge).buffer as ArrayBuffer,
      ),
      rpId: window.location.hostname,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: input.credentialId,
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

/** Prompts the physical asset passkey (WebAuthn / NFC tap). */
export async function authenticateToken(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey({
    challenge: session.challenge,
    credentialId: session.displayInfo.credentialId,
  });
}

/** Builds the two on-chain instructions after asset authentication. */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
): Promise<Instruction[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS;

  const { secp256r1Verify, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      publicKey: session.displayInfo.publicKey,
    });

  const recipientTokenAccount = await findAssociatedTokenAddress(
    session.recipient.address,
    session.displayInfo.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    session.displayInfo.currentOwner,
    session.displayInfo.mint,
    tokenProgram,
  );

  const executeTransfer = await getExecuteTransferInstructionAsync({
    recipient: session.recipient,
    sender: session.displayInfo.currentOwner,
    asset: session.displayInfo.asset,
    mint: session.displayInfo.mint,
    senderTokenAccount,
    recipientTokenAccount,
    tokenProgram,
    secp256r1VerifyArgs: {
      signedMessageIndex: 0,
      slotNumber: session.slotNumber,
      clientDataJson,
    },
  });

  return [secp256r1Verify, executeTransfer];
}
