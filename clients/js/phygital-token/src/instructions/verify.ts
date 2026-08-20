import {
  type AuthenticationResponseJSON,
  authenticateWithWebauthn,
  bufferToBase64URLString,
  nfcWebAuthnRequestOptions,
} from "../utils/passkey/webauthn.js";
import type { Address, Instruction } from "@solana/kit";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildVerifyChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getVerifyInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "./initialize.js";
import { findTokenPda } from "../utils/pdas/token.js";

export type VerifySession = {
  messageHash: Uint8Array;
  challenge: Uint8Array;
  /** When set, on-chain check requires SHA256(rpId) == authenticatorData[0..32]. */
  expectedRpId?: string;
  /** When set, on-chain check requires clientDataJSON.origin to equal this value. */
  expectedOrigin?: string;
};

/**
 * Prepares a verify session with `messageHash` as the WebAuthn challenge.
 * The token PDA is derived after the NFC tap from `response.id` (passkey).
 * Must be followed promptly by {@link authenticatePasskeyForVerify} and
 * {@link buildVerifyArgs} / {@link completeVerify}.
 */
export async function beginVerify(input: {
  messageHash: Uint8Array;
  expectedRpId?: string;
  expectedOrigin?: string;
}): Promise<VerifySession> {
  const challenge = await buildVerifyChallenge({
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
 * {@link beginVerify}.
 */
export async function authenticatePasskeyForVerify(
  session: VerifySession,
): Promise<AuthenticationResponseJSON> {
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(bufferToBase64URLString(session.challenge)),
  );
}

/**
 * Derives the token PDA from the tap (`response.id`) and builds the
 * secp256r1 verify instruction + args for `verify`.
 */
export async function buildVerifyArgs(
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<{
  tokenPda: Address;
  secp256r1Verify: Instruction;
  signedMessageIndex: number;
  clientDataJson: Uint8Array;
}> {
  const secp256r1PublicKey = parseSecp256r1Pubkey(response.id);
  const tokenPda = await findTokenPda(secp256r1PublicKey);
  const { secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      secp256r1PublicKey,
      response,
      existingSecp256r1VerifyInputs,
    });
  return {
    tokenPda,
    secp256r1Verify,
    signedMessageIndex,
    clientDataJson,
  };
}

/**
 * Builds `[secp256r1_verify, verify]` after token authentication.
 * Does not change ownership — only proves possession and advances
 * `last_sign_count`.
 */
export async function completeVerify(
  session: VerifySession,
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { tokenPda, secp256r1Verify, signedMessageIndex, clientDataJson } =
    await buildVerifyArgs(response, existingSecp256r1VerifyInputs);

  const verifyInstruction = getVerifyInstruction({
    token: tokenPda,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      clientDataJson,
    },
    messageHash: session.messageHash,
    expectedRpId: session.expectedRpId ?? null,
    expectedOrigin: session.expectedOrigin ?? null,
  });

  return [secp256r1Verify, verifyInstruction];
}
