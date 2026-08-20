import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getInitializeInstruction } from "../generated/instructions/initialize.js";
import type { PhygitalTokenType } from "../generated/types/phygitalTokenType.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { base64URLStringToBuffer } from "../utils/passkey/internal.js";
import { findTokenPda } from "../utils/pdas/token.js";
import type { Base64URLString } from "../utils/passkey/webauthn.js";

/**
 * Parse a base64url-encoded 33-byte compressed secp256r1 value
 * (passkey public key **or** chip identifier — both use the same wire shape).
 */
export function parseSecp256r1Pubkey(input: Base64URLString): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("secp256r1 value is required.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(base64URLStringToBuffer(trimmed));
  } catch {
    throw new Error("Value must be valid base64url.");
  }

  if (bytes.length !== 33) {
    throw new Error("Value must decode to 33 bytes.");
  }

  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
    throw new Error("Value must be compressed (starts with 0x02 or 0x03).");
  }

  return [bytes];
}

/** Alias — chip identifiers use the same 33-byte compressed layout as passkeys. */
export const parseIdentifier = parseSecp256r1Pubkey;

export type InitializeParams = {
  authority: TransactionSigner;
  /** Physical chip id stored on the token for binding (not the PDA seed). */
  identifier: Secp256r1Pubkey;
  /** Passkey that seeds the token PDA and authorizes transfers. */
  secp256r1Pubkey: Secp256r1Pubkey;
  tokenType: PhygitalTokenType;
};

/**
 * Build the `initialize` instruction that creates a token PDA seeded by
 * `secp256r1Pubkey` and stores `identifier` as a binding field.
 *
 * `authority` must be the designated admin
 * (`G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF`).
 */
export async function buildInitializeInstruction(
  input: InitializeParams,
): Promise<{ instruction: Instruction; token: Address }> {
  const token = await findTokenPda(input.secp256r1Pubkey);
  const instruction = getInitializeInstruction({
    authority: input.authority,
    token,
    identifier: input.identifier,
    secp256r1Pubkey: input.secp256r1Pubkey,
    tokenType: input.tokenType,
  });
  return { instruction, token };
}
