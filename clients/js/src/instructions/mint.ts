import { getTransferSolInstruction } from "@solana-program/system";
import {
  getAddressEncoder,
  getBase58Encoder,
  getBytesEncoder,
  getMinimumBalanceForRentExemption,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getCreateDesignMintInstructionAsync } from "../generated/instructions/createDesignMint";
import { getMintTokenInstructionAsync } from "../generated/instructions/mintToken";
import { findProgramAuthorityPda } from "../generated/pdas/programAuthority";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../generated/programs/phygitalNfts";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../utils/consts";
import { findAssociatedTokenAddress } from "../utils/associatedToken";

const DESIGN_MINT_SEED = new TextEncoder().encode("design_mint");
const CARD_INSTANCE_SEED = new TextEncoder().encode("card_instance");
const TOKEN_ACCOUNT_SIZE = 165n;

export const MAX_METADATA_NAME_LEN = 32;
export const MAX_METADATA_SYMBOL_LEN = 10;
export const MAX_METADATA_URI_LEN = 200;

export type MetadataFields = {
  name: string;
  symbol: string;
  uri: string;
};

export type CreateDesignMintParams = MetadataFields & {
  payer: TransactionSigner;
  owner: TransactionSigner;
  groupMint: Address;
  groupMintAuthority: TransactionSigner;
  designId: Address;
};

export type MintTokenParams = {
  authority: TransactionSigner;
  designMint: Address;
  secp256r1Pubkey: Secp256r1Pubkey;
  uri: string;
};

export async function findDesignMintPda(
  groupMint: Address,
  designId: Address,
): Promise<Address> {
  const [designMint] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_NFTS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(DESIGN_MINT_SEED),
      getAddressEncoder().encode(groupMint),
      getAddressEncoder().encode(designId),
    ],
  });

  return designMint;
}

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

export function parseSecp256r1Pubkey(input: string): Secp256r1Pubkey {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("secp256r1 pubkey is required.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(getBase58Encoder().encode(trimmed));
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
    throw new Error(`Name must be at most ${MAX_METADATA_NAME_LEN} characters.`);
  }
  if (fields.symbol.length > MAX_METADATA_SYMBOL_LEN) {
    throw new Error(`Symbol must be at most ${MAX_METADATA_SYMBOL_LEN} characters.`);
  }
  if (fields.uri.length > MAX_METADATA_URI_LEN) {
    throw new Error(`URI must be at most ${MAX_METADATA_URI_LEN} characters.`);
  }
}

export function getExpectedRentPoolTarget(): bigint {
  const ataRent = getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  return BigInt(ataRent) * 10n;
}

export async function getFundProgramAuthorityInstruction(
  payer: TransactionSigner,
  amount?: bigint,
) {
  const [programAuthority] = await findProgramAuthorityPda();
  return getTransferSolInstruction({
    source: payer,
    destination: programAuthority,
    amount: amount ?? getExpectedRentPoolTarget(),
  });
}

export async function getProgramAuthorityBalance(
  rpc: Rpc<SolanaRpcApi>,
): Promise<bigint> {
  const [programAuthority] = await findProgramAuthorityPda();
  const response = await rpc
    .getAccountInfo(programAuthority, { commitment: "confirmed" })
    .send();

  return response.value ? BigInt(response.value.lamports) : 0n;
}

export async function needsProgramAuthorityFunding(
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ needed: boolean; target: bigint; current: bigint; shortfall: bigint }> {
  const target = getExpectedRentPoolTarget();
  const current = await getProgramAuthorityBalance(rpc);
  const shortfall = target > current ? target - current : 0n;

  return {
    needed: shortfall > 0n,
    target,
    current,
    shortfall,
  };
}

export async function buildCreateDesignMintInstructions(
  input: CreateDesignMintParams,
): Promise<{ instructions: Instruction[]; designMint: Address }> {
  validateMetadataFields(input);

  const designMint = await findDesignMintPda(input.groupMint, input.designId);
  const instruction = await getCreateDesignMintInstructionAsync({
    payer: input.payer,
    owner: input.owner,
    groupMint: input.groupMint,
    groupMintAuthority: input.groupMintAuthority,
    designMint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    designId: input.designId,
  });

  return { instructions: [instruction], designMint };
}

export async function buildMintTokenInstructions(
  input: MintTokenParams,
): Promise<{ instructions: Instruction[]; cardInstance: Address }> {
  const cardInstance = await findCardInstancePda(input.secp256r1Pubkey);
  const [programAuthority] = await findProgramAuthorityPda();
  const programAuthorityTokenAccount = await findAssociatedTokenAddress(
    programAuthority,
    input.designMint,
    TOKEN_2022_PROGRAM_ADDRESS,
  );

  const instruction = await getMintTokenInstructionAsync({
    authority: input.authority,
    cardInstance,
    designMint: input.designMint,
    programAuthorityTokenAccount,
    secp256r1Pubkey: input.secp256r1Pubkey,
    designMintArg: input.designMint,
    uri: input.uri,
  });

  return { instructions: [instruction], cardInstance };
}

export async function buildMintTokenTransactionInstructions(
  rpc: Rpc<SolanaRpcApi>,
  input: MintTokenParams,
): Promise<{ instructions: Instruction[]; cardInstance: Address }> {
  const instructions: Instruction[] = [];
  const funding = await needsProgramAuthorityFunding(rpc);

  if (funding.needed) {
    instructions.push(
      await getFundProgramAuthorityInstruction(input.authority, funding.shortfall),
    );
  }

  const created = await buildMintTokenInstructions(input);
  instructions.push(...created.instructions);
  return { instructions, cardInstance: created.cardInstance };
}
