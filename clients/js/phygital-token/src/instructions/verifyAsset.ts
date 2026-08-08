import {
  type AuthenticationResponseJSON,
  authenticateWithWebauthn,
  bufferToBase64URLString,
  nfcWebAuthnRequestOptions,
} from "../utils/passkey/webauthn.js";
import type { Address, Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildVerifyAssetChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getVerifyAssetInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "./initialize.js";
import { findAssetPda } from "../utils/pdas/asset.js";

export type VerifyAssetSession = {
  messageHash: Uint8Array;
  challenge: Uint8Array;
  /** When set, on-chain check requires SHA256(rpId) == authenticatorData[0..32]. */
  expectedRpId?: string;
  /** When set, on-chain check requires clientDataJSON.origin to equal this value. */
  expectedOrigin?: string;
};

/**
 * Prepares a verify-asset session with `messageHash` as the WebAuthn challenge.
 * The asset PDA is derived after the NFC tap from `response.id` (passkey).
 * Must be followed promptly by {@link authenticatePasskeyForVerifyAsset} and
 * {@link buildVerifyAssetArgs} / {@link completeVerifyAsset}.
 */
export async function beginVerifyAsset(input: {
  messageHash: Uint8Array;
  expectedRpId?: string;
  expectedOrigin?: string;
}): Promise<VerifyAssetSession> {
  const challenge = await buildVerifyAssetChallenge({
    messageHash: input.messageHash,
  });

  return {
    messageHash: input.messageHash,
    challenge,
    expectedRpId: input.expectedRpId,
    expectedOrigin: input.expectedOrigin,
  };
}

/**
 * Prompts an NFC / WebAuthn tap for the session challenge from
 * {@link beginVerifyAsset}.
 */
export async function authenticatePasskeyForVerifyAsset(
  session: VerifyAssetSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(bufferToBase64URLString(session.challenge)),
  );
}

/**
 * Derives the asset PDA from the tap (`response.id`) and builds the
 * secp256r1 verify instruction + args for `verify_asset`.
 */
export async function buildVerifyAssetArgs(
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<{
  assetPda: Address;
  secp256r1Verify: Instruction;
  signedMessageIndex: number;
  clientDataJson: Uint8Array;
}> {
  const secp256r1PublicKey = parseSecp256r1Pubkey(response.id);
  const assetPda = await findAssetPda(secp256r1PublicKey);
  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      secp256r1PublicKey,
      response,
      existingSecp256r1VerifyInputs,
    });
  return {
    assetPda,
    secp256r1Verify,
    signedMessageIndex,
    clientDataJson,
  };
}

/**
 * Builds `[secp256r1_verify, verify_asset]` after asset authentication.
 * Does not change ownership — only proves possession and advances
 * `last_sign_count`.
 */
export async function completeVerifyAsset(
  session: VerifyAssetSession,
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { assetPda, secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildVerifyAssetArgs(
      response,
      existingSecp256r1VerifyInputs,
    );

  const verifyAssetInstruction = getVerifyAssetInstruction({
    asset: assetPda,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      clientDataJson,
    },
    messageHash: session.messageHash,
    expectedRpId: session.expectedRpId ?? null,
    expectedOrigin: session.expectedOrigin ?? null,
  });

  return [secp256r1Verify, verifyAssetInstruction];
}
