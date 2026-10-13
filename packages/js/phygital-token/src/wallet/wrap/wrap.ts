/**
 * Wraps a dApp's transaction so the accessory wallet can sign it: compile the
 * instructions for `execute_with_accessory`, check the policy, price fees,
 * collect the tap and assemble the final transaction.
 */
import {
  compileTransaction,
  decompileTransactionMessageFetchingLookupTables,
  estimateResourceLimitsFactory,
  getCompiledTransactionMessageDecoder,
  isTransactionWithBlockhashLifetime,
  type AccountMeta,
  type Address,
  type Instruction,
  type Rpc,
  type SignatureDictionary,
  type SolanaRpcApi,
  type Transaction,
  type TransactionWithLifetime,
} from "@solana/kit";
import {
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "../../instructions/verify.js";
import type { CompactInstructionArgs } from "../../generated/index.js";
import { PhygitalTokenError } from "../../utils/errors.js";
import { getLatestSlotHash } from "../../utils/slotHash.js";
import {
  buildExecuteChallenge,
  compileWalletInstructions,
  elevateRemainingForExecuteChallenge,
} from "../compile.js";
import { PolicyDeniedError } from "../preview.js";
import {
  AccessoryWalletTopUpRequired,
  canSpendLamports,
  getRefillInstruction,
  networkFeeLamports,
  planFee,
  RefillBlockedByTapLimit,
  topUpNeeded,
} from "../fees.js";
import type {
  BlockContext,
  PendingWalletWrap,
  PrepaidFees,
  PreparedWalletWrap,
  SignedTransaction,
  SlotEntry,
  WalletExecuteAccounts,
} from "./types.js";
import {
  applyBlockhashIfNeeded,
  applyFeePayerSignature,
  asV1TransactionMessage,
  buildWrappedBaseMessage,
  countTransactionSigners,
  withLifetimeConstraint,
} from "./message.js";
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  applyResourceLimits,
  fetchPriorityFeeMicroLamports,
  withMargin,
} from "./budget.js";
import { assertPolicyPreviewSucceeds, buildPolicyPreviewMessage } from "./policy-preview.js";

/** CU assumed when pricing a refill before the tap; the measured limit comes after. */
const REFILL_COMPUTE_UNIT_ESTIMATE = 400_000n;

/** Policy denials a refill transfer can cause: it spends SOL. */
const SOL_SPEND_DENIALS = new Set(["spend_not_allowed", "spend_limit", "max_per_tx"]);

const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;

async function prepareWrappedWalletTransaction(input: {
  rpc: Rpc<SolanaRpcApi>;
  transaction: Transaction & TransactionWithLifetime;
  walletPda: Address;
}): Promise<PreparedWalletWrap> {
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    input.transaction.messageBytes,
  );

  const decompileConfig = isTransactionWithBlockhashLifetime(input.transaction)
    ? {
        lastValidBlockHeight: input.transaction.lifetimeConstraint.lastValidBlockHeight,
      }
    : undefined;

  const decompiled = asV1TransactionMessage(
    await decompileTransactionMessageFetchingLookupTables(
      compiledMessage,
      input.rpc,
      decompileConfig,
    ),
  );

  const instructions = decompiled.instructions;

  const bodyInstructions: Instruction[] = [];
  const memoInstructions: Instruction[] = [];

  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i];
    if (instruction.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) continue;
    if (instruction.programAddress === MEMO_PROGRAM_ADDRESS) {
      memoInstructions.push(instruction);
    } else {
      bodyInstructions.push(instruction);
    }
  }

  if (bodyInstructions.length === 0) {
    throw new Error("Transaction has no instructions to wrap (only compute budget/memo, or empty)");
  }

  return {
    transaction: input.transaction,
    decompiled,
    bodyInstructions,
    memoInstructions,
  };
}

function elevateForExecuteAccounts(
  remainingAccounts: readonly AccountMeta[],
  executeAccounts: WalletExecuteAccounts,
): AccountMeta[] {
  const feePayerInRemaining = remainingAccounts.some(
    (m) => m.address === executeAccounts.feePayer.address,
  );
  return elevateRemainingForExecuteChallenge(remainingAccounts, {
    writableAddresses: [
      executeAccounts.phygitalToken,
      executeAccounts.policy,
      ...(feePayerInRemaining ? [executeAccounts.feePayer.address] : []),
    ],
    signerAddresses: feePayerInRemaining ? [executeAccounts.feePayer.address] : [],
  });
}

function buildPendingWalletWrap(
  prepared: PreparedWalletWrap,
  phygitalToken: Address,
  slot: SlotEntry,
  compiled: {
    compactInstructions: CompactInstructionArgs[];
    remainingAccounts: AccountMeta[];
  },
): PendingWalletWrap {
  return {
    prepared,
    compactInstructions: compiled.compactInstructions,
    remainingAccounts: compiled.remainingAccounts,
    slotNumber: slot.slotNumber,
    messageHash: buildExecuteChallenge({
      phygitalToken,
      slotHash: slot.slotHash,
      compactInstructions: compiled.compactInstructions,
      remainingAccounts: compiled.remainingAccounts,
    }),
  };
}

async function finalizeWrappedWalletTransaction(input: {
  rpc: Rpc<SolanaRpcApi>;
  pending: PendingWalletWrap;
  executeAccounts: WalletExecuteAccounts;
  passkeyTap: Awaited<ReturnType<typeof authenticatePasskeyForSecp256r1Verify>>;
  unitPrice: bigint;
  block: BlockContext | null;
  abortSignal?: AbortSignal;
}): Promise<SignedTransaction> {
  const { pending, executeAccounts, passkeyTap } = input;

  const { secp256r1VerifyInstruction, secp256r1VerifyArgs, phygitalTokenPda } =
    await buildSecp256r1VerifyInstruction(passkeyTap);
  if (phygitalTokenPda !== executeAccounts.phygitalToken) {
    throw new PhygitalTokenError(
      "PASSKEY_NOT_RECOGNIZED",
      "The tapped accessory is not this wallet's accessory.",
    );
  }

  const baseMessage = buildWrappedBaseMessage({
    pending,
    executeAccounts,
    secp256r1VerifyInstruction,
    secp256r1VerifyArgs,
  });

  // Estimate against the real execute envelope (includes secp) — not the preview.
  const limits = await estimateResourceLimitsFactory({ rpc: input.rpc })(baseMessage, {
    abortSignal: input.abortSignal,
  });

  let message = applyResourceLimits(
    baseMessage,
    withMargin(limits.computeUnitLimit),
    input.unitPrice,
    limits.loadedAccountsDataSizeLimit,
  );
  if (input.block) {
    message = applyBlockhashIfNeeded(message, input.block);
  }

  const compiledTx = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  return withLifetimeConstraint(compiledTx, message);
}

/**
 * Decides the refill before the tap (the tap signs the instructions). The
 * estimate prices CU generously; the fee service only needs the refill to
 * cover the final fee's shortfall.
 */
function planRefill(input: {
  prepaidFees: PrepaidFees;
  signatures: number;
  unitPrice: bigint;
  walletLamports: bigint;
  walletPda: Address;
}): bigint {
  const cost = networkFeeLamports({
    signatures: input.signatures,
    precompileSignatures: 1,
    priorityFeeLamports: (input.unitPrice * REFILL_COMPUTE_UNIT_ESTIMATE) / 1_000_000n,
  });
  const { refill } = planFee({
    balance: input.prepaidFees.balanceLamports,
    prepaid: input.prepaidFees.prepaidLamports,
    cost,
  });
  if (refill > 0n && !canSpendLamports(input.walletLamports, refill)) {
    throw new AccessoryWalletTopUpRequired(
      input.walletPda,
      topUpNeeded(input.walletLamports, refill),
    );
  }
  input.prepaidFees.onPlan?.({ source: refill > 0n ? "refill" : "free", refillLamports: refill });
  return refill;
}

/**
 * Wrap pipeline: RPC prefetch → refill plan → policy simulation → passkey → finalize → fee signing.
 */
export async function modifyAndWrapWalletTransaction(input: {
  rpc: Rpc<SolanaRpcApi>;
  transaction: Transaction & TransactionWithLifetime;
  walletPda: Address;
  executeAccounts: WalletExecuteAccounts;
  abortSignal?: AbortSignal;
  onPreview?: () => void;
  authenticate: (
    messageHash: Uint8Array,
  ) => Promise<Awaited<ReturnType<typeof authenticatePasskeyForSecp256r1Verify>>>;
  feePayer: (wrapped: SignedTransaction) => Promise<SignatureDictionary>;
  /** Set when the Revibase pool pays: a refill is added when the prepaid fees run low. */
  prepaidFees?: PrepaidFees;
}): Promise<SignedTransaction> {
  const prepared = await prepareWrappedWalletTransaction({
    rpc: input.rpc,
    transaction: input.transaction,
    walletPda: input.walletPda,
  });

  const earlyCompiled = compileWalletInstructions(prepared.bodyInstructions, input.walletPda);
  const remainingAccounts = elevateForExecuteAccounts(
    earlyCompiled.remainingAccounts,
    input.executeAccounts,
  );

  input.onPreview?.();
  const [fetchedPrice, slot, block, walletLamports] = await Promise.all([
    fetchPriorityFeeMicroLamports(
      input.rpc,
      {
        prepared,
        compactInstructions: earlyCompiled.compactInstructions,
        remainingAccounts,
        executeAccounts: input.executeAccounts,
      },
      input.abortSignal,
    ),
    getLatestSlotHash(input.rpc),
    input.rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send({ abortSignal: input.abortSignal })
      .then(({ value }) => value),
    input.prepaidFees
      ? input.rpc
          .getBalance(input.walletPda)
          .send({ abortSignal: input.abortSignal })
          .then(({ value }) => BigInt(value))
      : Promise.resolve(0n),
  ]);
  const cap = input.prepaidFees?.maxComputeUnitPriceMicroLamports;
  const unitPrice = cap !== undefined && fetchedPrice > cap ? cap : fetchedPrice;

  const refill = input.prepaidFees
    ? planRefill({
        prepaidFees: input.prepaidFees,
        signatures: countTransactionSigners(prepared, input.walletPda, input.executeAccounts),
        unitPrice,
        walletLamports,
        walletPda: input.walletPda,
      })
    : 0n;

  const compiled =
    refill > 0n
      ? compileWalletInstructions(
          [
            ...prepared.bodyInstructions,
            getRefillInstruction(input.walletPda, input.executeAccounts.feePayer.address, refill),
          ],
          input.walletPda,
        )
      : earlyCompiled;
  const compiledRemaining =
    refill > 0n
      ? elevateForExecuteAccounts(compiled.remainingAccounts, input.executeAccounts)
      : remainingAccounts;

  // Policy check uses placeholder v1 limits. Real CU / fees are measured at finalize.
  await assertPolicyPreviewSucceeds(
    input.rpc,
    buildPolicyPreviewMessage({
      prepared,
      compactInstructions: compiled.compactInstructions,
      remainingAccounts: compiledRemaining,
      executeAccounts: input.executeAccounts,
    }),
    input.abortSignal,
  ).catch(async (error: unknown) => {
    if (!(refill > 0n && error instanceof PolicyDeniedError && SOL_SPEND_DENIALS.has(error.code))) {
      throw error;
    }
    // Would it pass without the refill? Then the refill is what the limits block.
    await assertPolicyPreviewSucceeds(
      input.rpc,
      buildPolicyPreviewMessage({
        prepared,
        compactInstructions: earlyCompiled.compactInstructions,
        remainingAccounts,
        executeAccounts: input.executeAccounts,
      }),
      input.abortSignal,
    ).catch(() => {
      throw error;
    });
    throw new RefillBlockedByTapLimit(refill, input.prepaidFees!.manageUrl);
  });
  const pending = buildPendingWalletWrap(prepared, input.executeAccounts.phygitalToken, slot, {
    compactInstructions: compiled.compactInstructions,
    remainingAccounts: compiledRemaining,
  });

  input.abortSignal?.throwIfAborted();
  const passkeyTap = await input.authenticate(pending.messageHash);

  const wrapped = await finalizeWrappedWalletTransaction({
    rpc: input.rpc,
    pending,
    executeAccounts: input.executeAccounts,
    passkeyTap,
    unitPrice,
    block,
    abortSignal: input.abortSignal,
  });

  input.abortSignal?.throwIfAborted();
  const feePayerSignatures = await input.feePayer(wrapped);
  return applyFeePayerSignature(
    wrapped,
    input.walletPda,
    input.transaction.signatures,
    feePayerSignatures,
  );
}
