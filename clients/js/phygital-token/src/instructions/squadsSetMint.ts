import * as multisig from "@sqds/multisig";
import { type Address, type Instruction } from "@solana/kit";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getSetMintInstruction } from "../generated/instructions/setMint.js";
import type { Secp256r1Pubkey } from "../generated/types/secp256r1Pubkey.js";
import { ADMIN, INITIALIZE_MULTISIG_PDA } from "../utils/consts.js";
import { findTokenPda } from "../utils/pdas/token.js";
import {
  kitInstructionToWeb3,
  resolveConnection,
  toAddress,
  toPublicKey,
  web3InstructionToKit,
} from "../utils/web3Bridge.js";

export type BuildSquadsSetMintInput = {
  /** web3.js `Connection` or RPC URL string. */
  connection: Connection | string;
  /**
   * Squads multisig account (not the vault).
   * Defaults to {@link INITIALIZE_MULTISIG_PDA}.
   */
  multisigPda?: Address | string;
  /** 1/1 squad member that signs the outer transaction. */
  member: Address | string;
  setMintInputs: {
    secp256r1Pubkey: Secp256r1Pubkey;
    mint: Address;
  }[];
  /** Vault authority index; default `0`. */
  vaultIndex?: number;
};

export type BuildSquadsSetMintResult = {
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
 * Wrap `set_mint` in one Squads vault flow for the 1/1 authority vault.
 *
 * Builds create + propose + approve + execute + close as a **single** kit
 * instruction list. Execute remaining accounts are derived offline from the
 * same message that create stores (no post-create RPC round-trip).
 */
export async function buildSquadsSetMintInstructions(
  input: BuildSquadsSetMintInput,
): Promise<BuildSquadsSetMintResult> {
  const connection = resolveConnection(input.connection);
  const multisigPda = toPublicKey(input.multisigPda ?? INITIALIZE_MULTISIG_PDA);
  const member = toPublicKey(input.member);
  const vaultIndex = input.vaultIndex ?? 0;

  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: vaultIndex,
  });

  if (vaultPda.toBase58() !== ADMIN) {
    throw new Error(
      `Squads vault ${vaultPda.toBase58()} (index ${vaultIndex}) does not match ADMIN ${ADMIN}.`,
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

  const setMintIxs = await Promise.all(
    input.setMintInputs.map(async (item) =>
      buildVaultSetMintInstruction({
        vaultPda,
        token: await findTokenPda(item.secp256r1Pubkey),
        mint: item.mint,
      }),
    ),
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: setMintIxs,
  });

  const createIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: member,
    vaultIndex,
    ephemeralSigners: 0,
    transactionMessage,
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
    multisigPda: toAddress(multisigPda),
    vaultPda: toAddress(vaultPda),
    transactionIndex,
    instructions: [createIx, proposalIx, approveIx, executeIx, closeIx].map(
      web3InstructionToKit,
    ),
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

function buildVaultSetMintInstruction(input: {
  vaultPda: PublicKey;
  token: Address;
  mint: Address;
}): TransactionInstruction {
  const kitIx = getSetMintInstruction({
    token: input.token,
    mint: input.mint,
  });

  const web3Ix = kitInstructionToWeb3(kitIx);
  const authorityMeta = web3Ix.keys[0];
  if (!authorityMeta || !authorityMeta.pubkey.equals(input.vaultPda)) {
    throw new Error(
      "set_mint authority account does not match Squads vault PDA",
    );
  }
  // Vault must sign; program does not require the authority account to be writable.
  authorityMeta.isSigner = true;
  return web3Ix;
}
