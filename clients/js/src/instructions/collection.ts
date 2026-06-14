import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  getInitializeMint2Instruction,
  getMintSize,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
} from "@solana-program/token-2022";
import {
  getMinimumBalanceForRentExemption,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { generateKeyPairSigner } from "@solana/signers";

import { validateMetadataFields, type MetadataFields } from "./mint";

const DEFAULT_COLLECTION_MAX_SIZE = 2n ** 64n - 1n;

type CreateCollectionMintParams = MetadataFields & {
  payer: TransactionSigner;
  authority: TransactionSigner;
  maxSize?: bigint;
};

export async function buildCreateCollectionMintInstructions(
  input: CreateCollectionMintParams,
): Promise<{
  instructions: Instruction[];
  groupMint: Address;
  mintSigner: TransactionSigner;
}> {
  validateMetadataFields(input);

  const mintSigner = await generateKeyPairSigner();
  const mint = mintSigner.address;
  const authority = input.authority;

  const preExtensions = [
    extension("MetadataPointer", {
      authority: authority.address,
      metadataAddress: mint,
    }),
    extension("GroupPointer", {
      authority: authority.address,
      groupAddress: mint,
    }),
  ];

  const postExtensions = [
    extension("TokenGroup", {
      updateAuthority: authority.address,
      mint,
      size: 0n,
      maxSize: input.maxSize ?? DEFAULT_COLLECTION_MAX_SIZE,
    }),
    extension("TokenMetadata", {
      updateAuthority: authority.address,
      mint,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      additionalMetadata: new Map(),
    }),
  ];

  const initialSpace = getMintSize(preExtensions);
  const finalSpace = getMintSize([...preExtensions, ...postExtensions]);
  const lamports = getMinimumBalanceForRentExemption(BigInt(finalSpace));

  const instructions: Instruction[] = [
    getCreateAccountInstruction({
      payer: input.payer,
      newAccount: mintSigner,
      lamports,
      space: initialSpace,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint, preExtensions),
    getInitializeMint2Instruction({
      mint,
      decimals: 0,
      mintAuthority: authority.address,
    }),
    ...getPostInitializeInstructionsForMintExtensions(mint, authority, postExtensions),
  ];

  return { instructions, groupMint: mint, mintSigner };
}
