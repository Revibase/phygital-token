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
import {
  RP_ID,
  TOKEN_2022_PROGRAM_ADDRESS,
  TRANSFER_HOOK_PROGRAM_ADDRESS,
} from "../utils/consts";
import { type NftDisplayInfo } from "../utils/metadata";
import {
  buildSecp256r1VerifyInstructionFromWebAuthn,
  buildTransferChallenge,
} from "../utils/passkey/secp256r1";
import { getLatestSlotHash } from "../utils/slotHash";
import { getExecuteTransferInstructionAsync } from "../generated";
import { findAssociatedTokenAddress } from "../utils/associatedToken";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  nft: NftDisplayInfo;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the asset signature.
 * Must be followed promptly by authenticateAsset and completeTransfer.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  nft: NftDisplayInfo;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    asset: input.nft.asset,
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

/** Prompts the physical asset passkey (WebAuthn / NFC tap). */
export async function authenticateAsset(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        new Uint8Array(session.challenge).buffer as ArrayBuffer,
      ),
      rpId: RP_ID,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: bufferToBase64URLString(
            crypto.getRandomValues(new Uint8Array(32)).buffer,
          ),
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

  const {
    secp256r1Verify,
    origin,
    crossOrigin,
    truncatedClientDataJson,
    domainConfig,
  } = await buildSecp256r1VerifyInstructionFromWebAuthn({
    response,
    session,
  });

  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipient.address,
    session.nft.mint,
    tokenProgram,
  );
  const senderTokenAccount = await findAssociatedTokenAddress(
    session.nft.currentOwner,
    session.nft.mint,
    tokenProgram,
  );

  const executeTransfer = await getExecuteTransferInstructionAsync({
    domainConfig,
    recipient,
    sender: session.nft.currentOwner,
    asset: session.nft.asset,
    mint: session.nft.mint,
    senderTokenAccount,
    recipientTokenAccount,
    transferHookProgram: TRANSFER_HOOK_PROGRAM_ADDRESS,
    tokenProgram,
    signedMessageIndex: 0,
    slotNumber: session.slotNumber,
    origin,
    crossOrigin,
    truncatedClientDataJson,
  });

  return [secp256r1Verify, executeTransfer];
}
