/** Types shared by the wallet-wrap modules. */
import {
  decompileTransactionMessageFetchingLookupTables,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
  type Transaction,
  type TransactionPartialSigner,
  type TransactionWithLifetime,
  type TransactionWithinSizeLimit,
} from "@solana/kit";
import type { CompactInstructionArgs } from "../../generated/index.js";

export type SignedTransaction = Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;

export type DecompiledMessage = Awaited<
  ReturnType<typeof decompileTransactionMessageFetchingLookupTables>
>;

export type V1DecompiledMessage = Extract<DecompiledMessage, { version: 1 }>;

export type BlockContext = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

export type SlotEntry = { slotNumber: bigint; slotHash: Uint8Array };

export type WalletExecuteAccounts = {
  feePayer: TransactionPartialSigner;
  policy: Address;
  wallet: Address;
  phygitalToken: Address;
};

export type PreparedWalletWrap = {
  transaction: Transaction & TransactionWithLifetime;
  /** Always v1 — legacy / v0 inputs are upgraded at prepare. */
  decompiled: V1DecompiledMessage;
  bodyInstructions: Instruction[];
  memoInstructions: Instruction[];
};

export type PendingWalletWrap = {
  prepared: PreparedWalletWrap;
  compactInstructions: CompactInstructionArgs[];
  remainingAccounts: AccountMeta[];
  slotNumber: bigint;
  messageHash: Uint8Array;
};

/** The accessory's prepaid network fees, when the fee payer is the Revibase pool. */
export type PrepaidFees = {
  balanceLamports: bigint;
  prepaidLamports: bigint;
  /** Fee-service caps; the unit price is clamped to them. */
  maxComputeUnitPriceMicroLamports?: bigint;
  manageUrl: string;
  onPlan?: (plan: FeePlan) => void;
};

export type FeePlan = { source: "free" | "refill"; refillLamports: bigint };
