/**
 * Compute budget and priority fees for the wrapped v1 transaction: placeholder
 * limits for simulation, then measured limits for the final transaction.
 */
import {
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type AccountMeta,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { address } from "@solana/kit";
import type { CompactInstructionArgs } from "../../generated/index.js";
import type {
  DecompiledMessage,
  PendingWalletWrap,
  PreparedWalletWrap,
  V1DecompiledMessage,
  WalletExecuteAccounts,
} from "./types.js";
import {
  asV1TransactionMessage,
  buildWrappedBaseMessage,
  collectWritableAddresses,
} from "./message.js";

export const COMPUTE_BUDGET_PROGRAM_ADDRESS = address(
  "ComputeBudget111111111111111111111111111111",
);

const COMPUTE_UNIT_ESTIMATE_MARGIN = 1.1;

const DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 10_000n;

/** Round loaded-accounts data size up to the next 32 KiB page (v1 cost model). */
const LOADED_ACCOUNTS_PAGE_BYTES = 32 * 1024;

/** Agave max CU — used as a placeholder so v1 policy preview can simulate. */
const PREVIEW_COMPUTE_UNIT_LIMIT = 1_400_000;

/** Agave max loaded-accounts bytes — placeholder for v1 policy preview only. */
const PREVIEW_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

function stripComputeBudgetInstructions(instructions: readonly Instruction[]): Instruction[] {
  return instructions.filter(
    (instruction) => instruction.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS,
  );
}

function pickPriorityFeeMicroLamports(
  fees: readonly { prioritizationFee: bigint | number }[],
): bigint {
  const sorted = fees
    .map((fee) => BigInt(fee.prioritizationFee))
    .filter((fee) => fee > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (sorted.length === 0) {
    return DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5));
  return sorted[index];
}

export function withMargin(unitsConsumed: number): number {
  // Integer math — avoid `* 1.1` float rounding (100000 * 1.1 → 110000.00000000001).
  const tenths = Math.round(COMPUTE_UNIT_ESTIMATE_MARGIN * 10);
  return Math.min(1_400_000, Math.max(1, Math.ceil((unitsConsumed * tenths) / 10)));
}

function roundUpLoadedAccountsDataSize(bytes: number): number {
  if (bytes <= 0) return LOADED_ACCOUNTS_PAGE_BYTES;
  return Math.ceil(bytes / LOADED_ACCOUNTS_PAGE_BYTES) * LOADED_ACCOUNTS_PAGE_BYTES;
}

function priorityFeeLamportsFromMicroLamports(
  microLamportsPerCu: bigint,
  unitLimit: number,
): bigint {
  return (microLamportsPerCu * BigInt(unitLimit)) / 1_000_000n;
}

function stripBudgetAndEnsureV1(message: DecompiledMessage): V1DecompiledMessage {
  const v1 = asV1TransactionMessage(message);
  return {
    ...v1,
    instructions: stripComputeBudgetInstructions(v1.instructions),
  } as V1DecompiledMessage;
}

/**
 * Placeholder v1 config so policy preview can simulate (`sigVerify: false`).
 * Real CU / priority fee / loaded-accounts limits are applied only at finalize.
 */
export function applyPlaceholderResourceLimits(message: DecompiledMessage): V1DecompiledMessage {
  const withoutBudget = stripBudgetAndEnsureV1(message);
  let next = setTransactionMessageComputeUnitLimit(PREVIEW_COMPUTE_UNIT_LIMIT, withoutBudget);
  next = setTransactionMessagePriorityFeeLamports(0n, next);
  return setTransactionMessageLoadedAccountsDataSizeLimit<V1DecompiledMessage>(
    PREVIEW_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    next,
  );
}

/**
 * Apply measured CU / priority fee / loaded-accounts limits on the final v1 wrap.
 * ComputeBudget instructions are no-ops on v1 and are stripped.
 */
export function applyResourceLimits(
  message: DecompiledMessage,
  unitLimit: number,
  unitPriceMicroLamports: bigint,
  loadedAccountsDataSizeLimit?: number,
): V1DecompiledMessage {
  const withoutBudget = stripBudgetAndEnsureV1(message);

  let next = setTransactionMessageComputeUnitLimit(unitLimit, withoutBudget);
  next = setTransactionMessagePriorityFeeLamports(
    priorityFeeLamportsFromMicroLamports(unitPriceMicroLamports, unitLimit),
    next,
  );
  const dataSize = loadedAccountsDataSizeLimit ?? LOADED_ACCOUNTS_PAGE_BYTES;
  return setTransactionMessageLoadedAccountsDataSizeLimit<V1DecompiledMessage>(
    roundUpLoadedAccountsDataSize(dataSize),
    next,
  );
}

/** Priority-fee RPC for the same writable set finalize would price. */
export function fetchPriorityFeeMicroLamports(
  rpc: Rpc<SolanaRpcApi>,
  input: {
    prepared: PreparedWalletWrap;
    compactInstructions: CompactInstructionArgs[];
    remainingAccounts: AccountMeta[];
    executeAccounts: WalletExecuteAccounts;
  },
  abortSignal?: AbortSignal,
): Promise<bigint> {
  // Slot / messageHash unused for writable-account selection.
  const pending: PendingWalletWrap = {
    prepared: input.prepared,
    compactInstructions: input.compactInstructions,
    remainingAccounts: input.remainingAccounts,
    slotNumber: 0n,
    messageHash: new Uint8Array(32),
  };
  return rpc
    .getRecentPrioritizationFees(
      collectWritableAddresses(
        buildWrappedBaseMessage({
          pending,
          executeAccounts: input.executeAccounts,
        }),
      ),
    )
    .send({ abortSignal })
    .then(pickPriorityFeeMicroLamports);
}
