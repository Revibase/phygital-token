import {
  type AuthenticationResponseJSON,
  bufferToBase64URLString,
} from "../../utils/passkey/webauthn.js";
import { authenticatePasskey } from "../../utils/passkey/authenticate.js";
import type { Address, Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  type Secp256r1VerifyEntry,
} from "../../utils/passkey/secp256r1.js";
import { type Secp256r1VerifyArgsArgs } from "../../generated/index.js";
import { parseSecp256r1Pubkey } from "../../utils/parseSecp256r1Pubkey.js";
import { findPhygitalTokenPda } from "../../utils/pdas/token.js";

/**
 * Prompt an NFC / WebAuthn tap over a 32-byte challenge, used as the WebAuthn
 * challenge as-is (for `execute_with_accessory`, the execute challenge).
 *
 * @param input.allowList - Base64url compressed secp256r1 public keys. The tapped credential id must be in it; recovers a placeholder id locally when `rpc` is omitted.
 * @param input.rpc - Kit `Rpc` to recover a placeholder id on-chain (preferred over `allowList` for recovery).
 * @param input.messageHash - The 32-byte challenge.
 * @param input.rpId - Relying party ID. Defaults to the page hostname.
 */
export async function authenticatePasskeyForChallenge(input: {
  allowList?: ReadonlySet<string>;
  rpc?: Rpc<SolanaRpcApi>;
  messageHash: Uint8Array;
  rpId?: string;
}): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey(bufferToBase64URLString(input.messageHash), {
    allowList: input.allowList,
    rpc: input.rpc,
    rpId: input.rpId,
  });
}

/**
 * After the tap: the secp256r1 precompile instruction to prepend, the tapped
 * token's PDA, and the `secp256r1VerifyArgs` for the program instruction.
 *
 * @param verifyArgsRelativeIndex - Index of the precompile instruction
 *   relative to the program instruction. Default `-1` (immediately before).
 */
export async function buildSecp256r1VerifyFromTap(
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
    buildSecp256r1VerifyInstructionFromWebAuthnResponse({
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
