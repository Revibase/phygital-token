import {
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getMintTokenInstructionAsync } from "../generated/instructions/mintToken.js";
import { findProgramAuthorityPda } from "../generated/pdas/programAuthority.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts.js";
import { findAssociatedTokenAddress } from "../utils/associatedToken.js";
import { getCreateMintInstructionAsync } from "../generated/instructions/createMint.js";
import { base64URLStringToBuffer } from "../utils/passkey/internal.js";
import { findDomainConfigPda } from "../utils/pdas/domainConfig.js";
import { findAssetPda } from "../utils/pdas/asset.js";

export const MAX_METADATA_NAME_LEN = 32;
export const MAX_METADATA_SYMBOL_LEN = 10;
export const MAX_METADATA_URI_LEN = 200;

export type MetadataFields = {
  name: string;
  symbol: string;
  uri: string;
};

type CreateMintParams = MetadataFields & {
  payer: TransactionSigner;
  owner: TransactionSigner;
  groupMint: Address;
  groupMintAuthority: TransactionSigner;
  // The mint is now a caller-supplied keypair rather than a program-derived address.
  mint: TransactionSigner;
};

type MintTokenParams = {
  authority: TransactionSigner;
  mint: Address;
  secp256r1Pubkey: Secp256r1Pubkey;
  lockAssetOnCreate: boolean | null;
  domainConfig: Address
};

export function parseSecp256r1Pubkey(input: Base64URLString): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("secp256r1 pubkey is required.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(base64URLStringToBuffer(trimmed));
  } catch {
    throw new Error("Pubkey must be valid base64url.");
  }

  if (bytes.length !== 33) {
    throw new Error("Pubkey must decode to 33 bytes.");
  }

  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) {
    throw new Error("Pubkey must be compressed (starts with 0x02 or 0x03).");
  }

  return [bytes];
}

export function validateMetadataFields(fields: MetadataFields): void {
  if (fields.name.length > MAX_METADATA_NAME_LEN) {
    throw new Error(
      `Name must be at most ${MAX_METADATA_NAME_LEN} characters.`,
    );
  }
  if (fields.symbol.length > MAX_METADATA_SYMBOL_LEN) {
    throw new Error(
      `Symbol must be at most ${MAX_METADATA_SYMBOL_LEN} characters.`,
    );
  }
  if (fields.uri.length > MAX_METADATA_URI_LEN) {
    throw new Error(`URI must be at most ${MAX_METADATA_URI_LEN} characters.`);
  }
}

export async function buildCreateMintInstructions(
  input: CreateMintParams,
): Promise<{ instructions: Instruction[]; mint: Address }> {
  validateMetadataFields(input);

  const instruction = await getCreateMintInstructionAsync({
    payer: input.payer,
    owner: input.owner,
    groupMint: input.groupMint,
    groupMintAuthority: input.groupMintAuthority,
    mint: input.mint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
  });

  return { instructions: [instruction], mint: input.mint.address };
}

export async function buildMintTokenInstructions(
  input: MintTokenParams,
): Promise<Instruction[]> {
  const asset = await findAssetPda(input.secp256r1Pubkey);
  const [programAuthority] = await findProgramAuthorityPda();
  const programAuthorityTokenAccount = await findAssociatedTokenAddress(
    programAuthority,
    input.mint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  const instruction = await getMintTokenInstructionAsync({
    domainConfig: input.domainConfig,
    authority: input.authority,
    asset,
    mint: input.mint,
    programAuthorityTokenAccount,
    secp256r1Pubkey: input.secp256r1Pubkey,
    lockAssetOnCreate: input.lockAssetOnCreate,
  });

  return [instruction];
}
