import {
  type AuthenticationResponseJSON,
  startAuthentication,
  bufferToBase64URLString,
} from "@simplewebauthn/browser";
import type { Address, Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildVerifyAssetChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import {
  getVerifyAssetInstruction,
  type Asset,
} from "../generated/index.js";
import { findAssetPda } from "../utils/pdas/index.js";
import { parseSecp256r1Pubkey } from "./mint.js";
import { fetchAssetFromCredentialId } from "../utils/assetCredential.js";

export type VerifyAssetSession = {
  rpc: Rpc<SolanaRpcApi>;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
  message: Uint8Array;
};
/**
 * Prepares a verify asset session with slot-bound challenge data.
 * Recipient is chosen later at wallet confirmation — not bound in the asset signature.
 * Must be followed promptly by authenticateToken and completeTransfer.
 */
export async function beginVerifyAsset(input: {
  rpc: Rpc<SolanaRpcApi>;
  message: Uint8Array;
}): Promise<VerifyAssetSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildVerifyAssetChallenge({
    message: input.message,
    slotHash,
  });

  return {
    rpc: input.rpc,
    slotHash,
    slotNumber,
    challenge,
    message: input.message,
  };
}

export async function authenticatePasskeyForVerifyAsset(
  session: VerifyAssetSession,
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
          id: bufferToBase64URLString(crypto.getRandomValues(new Uint8Array(64)).buffer as ArrayBuffer),
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });
}

export async function buildVerifyAssetArgs(
  session: VerifyAssetSession,
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<{
  asset: Asset;
  assetPda: Address;
  secp256r1Verify: Instruction;
  signedMessageIndex: number;
  clientDataJson: Uint8Array;
}> {
  const { asset, publicKey } = await fetchAssetFromCredentialId(
    response.id,
    session.rpc,
  );
  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      publicKey,
      response,
      existingSecp256r1VerifyInputs,
    });
  return {
    asset,
    assetPda: await findAssetPda(parseSecp256r1Pubkey(publicKey)),
    secp256r1Verify,
    signedMessageIndex,
    clientDataJson,
  };
}

export async function completeVerifyAsset(
  session: VerifyAssetSession,
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { assetPda, secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildVerifyAssetArgs(
      session,
      response,
      existingSecp256r1VerifyInputs,
    );

  const verifyAssetInstruction = getVerifyAssetInstruction({
    asset: assetPda,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      slotNumber: session.slotNumber,
      clientDataJson,
    },
    message: session.message,
  });

  return [secp256r1Verify, verifyAssetInstruction];
}
