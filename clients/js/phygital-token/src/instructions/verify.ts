import {
  type AuthenticationResponseJSON,
  authenticateWithWebauthn,
  bufferToBase64URLString,
  nfcWebAuthnRequestOptions,
} from "../utils/passkey/webauthn.js";
import type { Address, Instruction } from "@solana/kit";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { type Secp256r1VerifyArgsArgs } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../utils/parseSecp256r1Pubkey.js";
import { findPhygitalTokenPda } from "../utils/pdas/token.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** SHA-256 `message` to a 32-byte digest for on-chain `verify`. */
export function buildMessageHash(message: Uint8Array): Uint8Array {
  return sha256(message);
}

/**
 * Prompt an NFC / WebAuthn tap for on-chain `verify`.
 *
 * Uses `messageHash` (32 bytes) directly as the WebAuthn challenge — the same
 * digest your program must pass to `VerifyCpiBuilder.message_hash`. Hash with
 * {@link buildMessageHash} first.
 *
 * @param input.messageHash - SHA-256 of the message you bind on-chain (32 bytes).
 * @param input.rpId - WebAuthn relying party for the **browser tap** only.
 *   Defaults to `window.location.hostname`. On-chain `expected_rp_id` /
 *   `expected_origins` are set on your CPI, not here.
 */
export async function authenticatePasskeyForSecp256r1Verify(input: {
  messageHash: Uint8Array;
  rpId?: string;
}): Promise<AuthenticationResponseJSON> {
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(
      bufferToBase64URLString(input.messageHash),
      input.rpId ?? window.location.hostname,
    ),
  );
}

/**
 * After the tap: secp256r1_verify instruction to prepend, plus the phygital
 * token PDA (`phygitalTokenPda`) and `secp256r1VerifyArgs` for
 * `VerifyCpiBuilder`.
 *
 * `message_hash`, the instructions sysvar, and optional `expected_rp_id` /
 * `expected_origins` come from your program instruction — not this return
 * value. When `expected_origins` is set, the signed origin must match one
 * listed origin; omit it to skip the origin check.
 *
 * @param verifyArgsRelativeIndex - Index of the secp instruction relative to
 *   yours. Default `-1` (secp immediately precedes your instruction).
 */
export async function buildSecp256r1VerifyInstruction(
  response: AuthenticationResponseJSON,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
  verifyArgsRelativeIndex = -1,
): Promise<{
  secp256r1VerifyInstruction: Instruction;
  phygitalTokenPda: Address;
  secp256r1VerifyArgs: Secp256r1VerifyArgsArgs;
}> {
  const secp256r1PublicKey = parseSecp256r1Pubkey(response.id);
  const phygitalTokenPda = await findPhygitalTokenPda(secp256r1PublicKey);
  const { secp256r1VerifyInstruction, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      secp256r1PublicKey,
      response,
      existingSecp256r1VerifyInputs,
    });
  return {
    secp256r1VerifyInstruction,
    phygitalTokenPda,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex,
      signedMessageIndex,
      clientDataJson,
    },
  };
}
