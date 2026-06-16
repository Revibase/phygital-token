import {
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Encoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getMintTokenInstructionAsync } from "../generated/instructions/mintToken";
import { findProgramAuthorityPda } from "../generated/pdas/programAuthority";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../generated/programs/phygitalNfts";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import { findAssociatedTokenAddress } from "../utils/associatedToken";
import { getCreateMintInstructionAsync } from "../generated/instructions/createMint";
import { base64URLStringToBuffer } from "../utils/encoding";

const CARD_INSTANCE_SEED = new TextEncoder().encode("card_instance");

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
  designId: Address;
};

type MintTokenParams = {
  authority: TransactionSigner;
  mint: Address;
  secp256r1Pubkey: Secp256r1Pubkey;
};

export async function findCardInstancePda(
  secp256r1Pubkey: Secp256r1Pubkey,
): Promise<Address> {
  const [cardInstance] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_NFTS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(CARD_INSTANCE_SEED),
      getBytesEncoder().encode(secp256r1Pubkey[0].slice(1)),
    ],
  });

  return cardInstance;
}

export function parseSecp256r1Pubkey(input: Base64URLString): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("secp256r1 pubkey is required.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(base64URLStringToBuffer(trimmed));
  } catch {
    throw new Error("Pubkey must be valid base58.");
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
): Promise<{ instructions: Instruction[]; mint: TransactionSigner }> {
  validateMetadataFields(input);

  const mint = await generateKeyPairSigner();
  const instruction = await getCreateMintInstructionAsync({
    payer: input.payer,
    owner: input.owner,
    groupMint: input.groupMint,
    groupMintAuthority: input.groupMintAuthority,
    mint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
  });

  return { instructions: [instruction], mint };
}

export async function buildMintTokenInstructions(
  input: MintTokenParams,
): Promise<{ instructions: Instruction[]; cardInstance: Address }> {
  const cardInstance = await findCardInstancePda(input.secp256r1Pubkey);
  const [programAuthority] = await findProgramAuthorityPda();
  const programAuthorityTokenAccount = await findAssociatedTokenAddress(
    programAuthority,
    input.mint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  const instruction = await getMintTokenInstructionAsync({
    authority: input.authority,
    cardInstance,
    mint: input.mint,
    programAuthorityTokenAccount,
    secp256r1Pubkey: input.secp256r1Pubkey,
  });

  return { instructions: [instruction], cardInstance };
}
