import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getInitializeInstruction } from "../generated/instructions/initialize.js";
import type { AssetType } from "../generated/types/assetType.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { base64URLStringToBuffer } from "../utils/passkey/internal.js";
import { findAssetPda } from "../utils/pdas/asset.js";
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
  /** Physical chip id stored on the asset for binding (not the PDA seed). */
  identifier: Secp256r1Pubkey;
  /** Passkey that seeds the asset PDA and authorizes transfers. */
  secp256r1Pubkey: Secp256r1Pubkey;
  assetType: AssetType;
};

/**
 * Build the `initialize` instruction that creates an asset PDA seeded by
 * `secp256r1Pubkey` and stores `identifier` as a binding field.
 */
export async function buildInitializeInstruction(
  input: InitializeParams,
): Promise<{ instruction: Instruction; asset: Address }> {
  const asset = await findAssetPda(input.secp256r1Pubkey);
  const instruction = getInitializeInstruction({
    authority: input.authority,
    asset,
    identifier: input.identifier,
    secp256r1Pubkey: input.secp256r1Pubkey,
    assetType: input.assetType,
  });
  return { instruction, asset };
}
