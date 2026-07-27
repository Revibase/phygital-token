import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMintInstruction,
  getInitializeTokenGroupMemberInstruction,
  getMintSize,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  type ExtensionArgs,
} from "@solana-program/token-2022";
import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import { getMintTokenInstructionAsync } from "../generated/instructions/mintToken.js";
import { findProgramAuthorityPda } from "../generated/pdas/programAuthority.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  TRANSFER_HOOK_PROGRAM_ADDRESS,
} from "../utils/consts.js";
import { findAssociatedTokenAddress } from "../utils/associatedToken.js";
import { base64URLStringToBuffer } from "../utils/passkey/internal.js";
import { findAssetPda } from "../utils/pdas/asset.js";
import type { AssetType } from "../generated/index.js";
import type { Base64URLString } from "../utils/passkey/webauthn.js";

export const MAX_METADATA_NAME_LEN = 32;
export const MAX_METADATA_SYMBOL_LEN = 10;
export const MAX_METADATA_URI_LEN = 200;

const POST_INITIALIZE_MINT_EXTENSIONS: ExtensionArgs["__kind"][] = [
  "TokenMetadata",
  "TokenGroup",
  "TokenGroupMember",
];

export type MetadataFields = {
  name: string;
  symbol: string;
  uri: string;
};

type CreateMintParams = MetadataFields & {
  rpc: Rpc<SolanaRpcApi>;
  payer: TransactionSigner;
  owner: TransactionSigner;
  groupMint: Address;
  groupMintAuthority: TransactionSigner;
  mint: TransactionSigner;
  mintAuthority: TransactionSigner;
};

type MintTokenParams = {
  authority: TransactionSigner;
  mint: Address;
  secp256r1Pubkey: Secp256r1Pubkey;
  assetType: AssetType;
};

function designMintExtensions(
  programAuthority: Address,
  mint: Address,
  owner: Address,
  groupMint: Address,
  fields: MetadataFields,
): ExtensionArgs[] {
  return [
    {
      __kind: "MetadataPointer",
      authority: programAuthority,
      metadataAddress: mint,
    },
    {
      __kind: "TransferHook",
      authority: programAuthority,
      programId: TRANSFER_HOOK_PROGRAM_ADDRESS,
    },
    {
      __kind: "PermanentDelegate",
      delegate: programAuthority,
    },
    {
      __kind: "GroupMemberPointer",
      authority: programAuthority,
      memberAddress: mint,
    },
    {
      __kind: "TokenGroupMember",
      mint,
      group: groupMint,
      memberNumber: 0n,
    },
    {
      __kind: "TokenMetadata",
      updateAuthority: owner,
      mint,
      name: fields.name,
      symbol: fields.symbol,
      uri: fields.uri,
      additionalMetadata: new Map(),
    },
  ];
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

  const [programAuthority] = await findProgramAuthorityPda();
  const mint = input.mint.address;
  const extensions = designMintExtensions(
    programAuthority,
    mint,
    input.owner.address,
    input.groupMint,
    input,
  );
  const initialExtensions = extensions.filter(
    (extension) => !POST_INITIALIZE_MINT_EXTENSIONS.includes(extension.__kind),
  );
  const space = getMintSize(initialExtensions);
  const rentSpace = getMintSize(extensions);
  const lamports = await input.rpc.getMinimumBalanceForRentExemption(
    BigInt(rentSpace),
  ).send();

  const instructions: Instruction[] = [
    getCreateAccountInstruction({
      payer: input.payer,
      newAccount: input.mint,
      lamports,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint, extensions),
    getInitializeMintInstruction({
      mint,
      decimals: 0,
      mintAuthority: input.mintAuthority.address,
      freezeAuthority: null,
    }),
    getInitializeTokenGroupMemberInstruction({
      member: mint,
      memberMint: mint,
      memberMintAuthority: input.mintAuthority,
      group: input.groupMint,
      groupUpdateAuthority: input.groupMintAuthority,
    }),
    ...getPostInitializeInstructionsForMintExtensions(
      mint,
      input.mintAuthority,
      extensions,
    ),
  ];

  return { instructions, mint };
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
    authority: input.authority,
    asset,
    mint: input.mint,
    programAuthorityTokenAccount,
    secp256r1Pubkey: input.secp256r1Pubkey,
    assetType: input.assetType,
  });

  return [instruction];
}
