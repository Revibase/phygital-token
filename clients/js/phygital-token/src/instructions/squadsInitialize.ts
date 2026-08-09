import * as multisig from "@sqds/multisig";
import { type Address, type Instruction } from "@solana/kit";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getInitializeInstruction } from "../generated/instructions/initialize.js";
import type { AssetType } from "../generated/types/assetType.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import {
  INITIALIZE_AUTHORITY,
  INITIALIZE_MULTISIG_PDA,
} from "../utils/consts.js";
import { findAssetPda } from "../utils/pdas/asset.js";
import {
  kitInstructionToWeb3,
  resolveConnection,
  toAddress,
  toPublicKey,
  web3InstructionToKit,
} from "../utils/web3Bridge.js";

export type BuildSquadsInitializeInput = {
  /** web3.js `Connection` or RPC URL string. */
  connection: Connection | string;
  /**
   * Squads multisig account (not the vault).
   * Defaults to {@link INITIALIZE_MULTISIG_PDA}.
   */
  multisigPda?: Address | string;
  /** 1/1 squad member that signs the outer transaction. */
  member: Address | string;
  identifier: Secp256r1Pubkey;
  secp256r1Pubkey: Secp256r1Pubkey;
  assetType: AssetType;
  /** Vault authority index; default `0`. */
  vaultIndex?: number;
  memo?: string;
};

export type BuildSquadsInitializeResult = {
  asset: Address;
  multisigPda: Address;
  vaultPda: Address;
  transactionIndex: bigint;
  /**
   * Single outer transaction (member signs as fee payer):
   * create vault tx → create proposal → approve → execute → close accounts.
   * Close returns proposal/tx rent to the multisig rent collector (the vault).
   */
  instructions: Instruction[];
};

/**
 * Wrap `initialize` in one Squads vault flow for the 1/1 authority vault.
 *
 * Builds create + propose + approve + execute + close as a **single** kit
 * instruction list. Execute remaining accounts are derived offline from the
 * same message that create stores (no post-create RPC round-trip).
 */
export async function buildSquadsInitializeInstructions(
  input: BuildSquadsInitializeInput,
): Promise<BuildSquadsInitializeResult> {
  const connection = resolveConnection(input.connection);
  const multisigPda = toPublicKey(input.multisigPda ?? INITIALIZE_MULTISIG_PDA);
  const member = toPublicKey(input.member);
  const vaultIndex = input.vaultIndex ?? 0;

  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: vaultIndex,
  });

  if (vaultPda.toBase58() !== INITIALIZE_AUTHORITY) {
    throw new Error(
      `Squads vault ${vaultPda.toBase58()} (index ${vaultIndex}) does not match INITIALIZE_AUTHORITY ${INITIALIZE_AUTHORITY}.`,
    );
  }

  const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );

  if (multisigInfo.rentCollector == null) {
    throw new Error(
      "Multisig has no rentCollector set; configure one before closing vault transactions.",
    );
  }

  const transactionIndex =
    BigInt(multisig.utils.toBigInt(multisigInfo.transactionIndex)) + 1n;

  const asset = await findAssetPda(input.secp256r1Pubkey);
  const initializeIx = buildVaultInitializeInstruction({
    vaultPda,
    asset,
    identifier: input.identifier,
    secp256r1Pubkey: input.secp256r1Pubkey,
    assetType: input.assetType,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [initializeIx],
  });

  const createIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: member,
    vaultIndex,
    ephemeralSigners: 0,
    transactionMessage,
    memo: input.memo ?? "phygital initialize",
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    creator: member,
    transactionIndex,
  });

  const approveIx = multisig.instructions.proposalApprove({
    multisigPda,
    member,
    transactionIndex,
  });

  const executeIx = await buildVaultTransactionExecuteInstruction({
    connection,
    multisigPda,
    vaultPda,
    member,
    transactionIndex,
    transactionMessage,
  });

  const closeIx = multisig.instructions.vaultTransactionAccountsClose({
    multisigPda,
    rentCollector: multisigInfo.rentCollector,
    transactionIndex,
  });

  return {
    asset,
    multisigPda: toAddress(multisigPda),
    vaultPda: toAddress(vaultPda),
    transactionIndex,
    instructions: [
      createIx,
      proposalIx,
      approveIx,
      executeIx,
      closeIx,
    ].map(web3InstructionToKit),
  };
}

async function buildVaultTransactionExecuteInstruction(input: {
  connection: Connection;
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  member: PublicKey;
  transactionIndex: bigint;
  transactionMessage: TransactionMessage;
}): Promise<TransactionInstruction> {
  const [transactionPda] = multisig.getTransactionPda({
    multisigPda: input.multisigPda,
    index: input.transactionIndex,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda: input.multisigPda,
    transactionIndex: input.transactionIndex,
  });

  // Match the message layout vaultTransactionCreate will store (no ALTs).
  const compiled = input.transactionMessage.compileToV0Message();
  const vaultMessage = {
    numSigners: compiled.header.numRequiredSignatures,
    numWritableSigners:
      compiled.header.numRequiredSignatures -
      compiled.header.numReadonlySignedAccounts,
    numWritableNonSigners:
      compiled.staticAccountKeys.length -
      compiled.header.numRequiredSignatures -
      compiled.header.numReadonlyUnsignedAccounts,
    accountKeys: compiled.staticAccountKeys,
    instructions: compiled.compiledInstructions.map((ci) => ({
      programIdIndex: ci.programIdIndex,
      accountIndexes: Uint8Array.from(ci.accountKeyIndexes),
      data: Uint8Array.from(ci.data),
    })),
    addressTableLookups: [],
  };

  const { accountMetas } = await multisig.utils.accountsForTransactionExecute({
    connection: input.connection,
    message: vaultMessage,
    ephemeralSignerBumps: [],
    vaultPda: input.vaultPda,
    transactionPda,
  });

  return multisig.generated.createVaultTransactionExecuteInstruction({
    multisig: input.multisigPda,
    member: input.member,
    proposal: proposalPda,
    transaction: transactionPda,
    anchorRemainingAccounts: accountMetas,
  });
}

function buildVaultInitializeInstruction(input: {
  vaultPda: PublicKey;
  asset: Address;
  identifier: Secp256r1Pubkey;
  secp256r1Pubkey: Secp256r1Pubkey;
  assetType: AssetType;
}): TransactionInstruction {
  const kitIx = getInitializeInstruction({
    asset: input.asset,
    identifier: input.identifier,
    secp256r1Pubkey: input.secp256r1Pubkey,
    assetType: input.assetType,
  });

  const web3Ix = kitInstructionToWeb3(kitIx);
  const authorityMeta = web3Ix.keys[0];
  if (!authorityMeta || !authorityMeta.pubkey.equals(input.vaultPda)) {
    throw new Error(
      "initialize authority account does not match Squads vault PDA",
    );
  }
  authorityMeta.isSigner = true;
  authorityMeta.isWritable = true;
  return web3Ix;
}
