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
import { getLatestSlotHash } from "../utils/slotHash.js";
import {
  fetchAsset,
  getVerifyAssetInstruction,
  type Asset,
} from "../generated/index.js";
import { findAssetPda } from "../utils/pdas/index.js";
import { parseSecp256r1Pubkey } from "./mint.js";

export type VerifyAssetSession = {
  rpc: Rpc<SolanaRpcApi>;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
  message: Uint8Array;
};
/**
 * Prepares a verify-asset session with a slot-bound challenge for `message`.
 * Must be followed promptly by {@link authenticatePasskeyForVerifyAsset} and
 * {@link buildVerifyAssetArgs} / {@link completeVerifyAsset}.
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
  const asset = (
    await fetchAsset(
      session.rpc,
      await findAssetPda(parseSecp256r1Pubkey(response.id)),
    )
  ).data;
  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      secp256r1PublicKey: asset.publicKey,
      response,
      existingSecp256r1VerifyInputs,
    });
  return {
    asset,
    assetPda: await findAssetPda(asset.publicKey),
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
