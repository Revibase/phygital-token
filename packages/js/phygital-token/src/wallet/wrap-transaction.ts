import {
  compileTransaction,
  decompileTransactionMessageFetchingLookupTables,
  estimateResourceLimitsFactory,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSolanaErrorFromTransactionError,
  isTransactionMessageWithBlockhashLifetime,
  isTransactionWithBlockhashLifetime,
  isSignerRole,
  isWritableRole,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
  type Rpc,
  type SignatureDictionary,
  type SignaturesMap,
  type SolanaRpcApi,
  type Transaction,
  type TransactionPartialSigner,
  type TransactionSigner,
  type TransactionWithLifetime,
  type TransactionWithinSizeLimit,
} from "@solana/kit";
import { address } from "@solana/kit";
import {
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "../instructions/verify.js";
import {
  getExecuteWithAccessoryInstruction,
  getPreviewExecuteInstruction,
  type CompactInstructionArgs,
  type Secp256r1VerifyArgsArgs,
} from "../generated/index.js";
import { PhygitalTokenError } from "../utils/errors.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import {
  buildExecuteChallenge,
  compileWalletInstructions,
  elevateRemainingForExecuteChallenge,
  withRemainingAccounts,
} from "./compile.js";
import { isPreviewPassed, PolicyDeniedError, policyDeniedErrorFromSolanaError } from "./preview.js";
import {
  AccessoryWalletTopUpRequired,
  canSpendLamports,
  getRefillInstruction,
  networkFeeLamports,
  planFee,
  RefillBlockedByTapLimit,
  topUpNeeded,
} from "./fees.js";

const COMPUTE_BUDGET_PROGRAM_ADDRESS = address("ComputeBudget111111111111111111111111111111");
/** Refresh the tx blockhash when fewer than this many slots remain (~25s at 400ms). */
const MIN_BLOCKHASH_REMAINING_SLOTS = 64n;
const COMPUTE_UNIT_ESTIMATE_MARGIN = 1.1;
const DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 10_000n;
/** CU assumed when pricing a refill before the tap; the measured limit comes after. */
const REFILL_COMPUTE_UNIT_ESTIMATE = 400_000n;
/** Policy denials a refill transfer can cause: it spends SOL. */
const SOL_SPEND_DENIALS = new Set(["spend_not_allowed", "spend_limit", "max_per_tx"]);

type SlotEntry = { slotNumber: bigint; slotHash: Uint8Array };

const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;

/** Round loaded-accounts data size up to the next 32 KiB page (v1 cost model). */
const LOADED_ACCOUNTS_PAGE_BYTES = 32 * 1024;
/** Agave max CU — used as a placeholder so v1 policy preview can simulate. */
const PREVIEW_COMPUTE_UNIT_LIMIT = 1_400_000;
/** Agave max loaded-accounts bytes — placeholder for v1 policy preview only. */
const PREVIEW_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

/** Account metas for execute don't depend on the passkey payload. */
const PLACEHOLDER_SECP_ARGS: Secp256r1VerifyArgsArgs = {
  verifyArgsRelativeIndex: 0,
  signedMessageIndex: 0,
  clientDataJson: new Uint8Array(0),
};

type SignedTransaction = Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;

export type WalletExecuteAccounts = {
  feePayer: TransactionPartialSigner;
  policy: Address;
  wallet: Address;
  phygitalToken: Address;
};

type DecompiledMessage = Awaited<
  ReturnType<typeof decompileTransactionMessageFetchingLookupTables>
>;

type V1DecompiledMessage = Extract<DecompiledMessage, { version: 1 }>;

type PreparedWalletWrap = {
  transaction: Transaction & TransactionWithLifetime;
  /** Always v1 — legacy / v0 inputs are upgraded at prepare. */
  decompiled: V1DecompiledMessage;
  bodyInstructions: Instruction[];
  memoInstructions: Instruction[];
};

type PendingWalletWrap = {
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

type BlockContext = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

function stripComputeBudgetInstructions(instructions: readonly Instruction[]): Instruction[] {
  return instructions.filter(
    (instruction) => instruction.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS,
  );
}

function toStaticAccountMeta(account: {
  address: Address;
  role: AccountMeta["role"];
}): AccountMeta {
  return { address: account.address, role: account.role };
}

function toStaticInstruction(instruction: Instruction): Instruction {
  if (!instruction.accounts?.length) {
    return instruction;
  }
  return {
    ...instruction,
    accounts: instruction.accounts.map(toStaticAccountMeta),
  };
}

/**
 * Upgrade any decompiled message to v1: flatten ALT metas, drop incoming v1
 * config (limits are set separately for preview vs finalize), set `version: 1`.
 */
export function asV1TransactionMessage(message: DecompiledMessage): V1DecompiledMessage {
  const { config: _incomingConfig, ...rest } = message as DecompiledMessage & {
    config?: unknown;
  };
  return {
    ...rest,
    version: 1,
    instructions: Array.from(message.instructions, toStaticInstruction),
  } as V1DecompiledMessage;
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

function withMargin(unitsConsumed: number): number {
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

function collectWritableAddresses(message: DecompiledMessage): Address[] {
  const writable = new Set<Address>();

  if ("feePayer" in message && message.feePayer) {
    writable.add(message.feePayer.address);
  }

  for (const instruction of message.instructions) {
    for (const account of instruction.accounts ?? []) {
      if (isWritableRole(account.role)) {
        writable.add(account.address);
      }
    }
  }

  return [...writable];
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
function applyPlaceholderResourceLimits(message: DecompiledMessage): V1DecompiledMessage {
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
function applyResourceLimits(
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

function applyBlockhashIfNeeded<T extends DecompiledMessage>(message: T, block: BlockContext): T {
  if (!isTransactionMessageWithBlockhashLifetime(message)) {
    return message;
  }

  const { lastValidBlockHeight } = message.lifetimeConstraint;
  if (lastValidBlockHeight > block.lastValidBlockHeight + MIN_BLOCKHASH_REMAINING_SLOTS) {
    return message;
  }

  return setTransactionMessageLifetimeUsingBlockhash(block, message) as T;
}

function withLifetimeConstraint(
  transaction: Transaction,
  message: DecompiledMessage,
): SignedTransaction {
  if (!("lifetimeConstraint" in message)) {
    return transaction as SignedTransaction;
  }

  return {
    ...transaction,
    lifetimeConstraint: message.lifetimeConstraint,
  } as SignedTransaction;
}

/**
 * Wallet PDA cannot pay fees (no private key). If it is the fee payer, swap in
 * the configured fee-payer signer.
 */
function withFeePayerIfWallet<T extends DecompiledMessage>(
  message: T,
  walletPda: Address,
  feePayer: TransactionSigner,
): T {
  if (message.feePayer?.address !== walletPda) {
    return message;
  }
  return setTransactionMessageFeePayerSigner(feePayer, message) as T;
}

/**
 * Post fee-payer-swap wrap message for CU / fee account selection.
 * Omit secp to price fees before the passkey tap.
 */
function buildWrappedBaseMessage(input: {
  pending: PendingWalletWrap;
  executeAccounts: WalletExecuteAccounts;
  secp256r1VerifyInstruction?: Instruction;
  secp256r1VerifyArgs?: Secp256r1VerifyArgsArgs;
}): V1DecompiledMessage {
  const { pending, executeAccounts } = input;

  const executeIx = getExecuteWithAccessoryInstruction({
    phygitalToken: executeAccounts.phygitalToken,
    policy: executeAccounts.policy,
    wallet: executeAccounts.wallet,
    compactInstructions: pending.compactInstructions,
    secp256r1VerifyArgs: input.secp256r1VerifyArgs ?? PLACEHOLDER_SECP_ARGS,
    slotNumber: pending.slotNumber,
  });

  const executeWithRemaining = withRemainingAccounts(executeIx, pending.remainingAccounts);
  const instructions = [
    ...(input.secp256r1VerifyInstruction ? [input.secp256r1VerifyInstruction] : []),
    executeWithRemaining,
    ...pending.prepared.memoInstructions,
  ];

  const baseMessage = asV1TransactionMessage({
    ...pending.prepared.decompiled,
    instructions,
  } as DecompiledMessage);

  return withFeePayerIfWallet(baseMessage, executeAccounts.wallet, executeAccounts.feePayer);
}

/** The page origin the browser will put in the tap's `clientDataJSON`, if any. */
function pageOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return typeof location?.origin === "string" ? location.origin : undefined;
}

/**
 * `preview_execute` in place of `execute_with_accessory`: every check a tap
 * faces except the tap itself — this page's origin, then the policy. It never lands.
 */
function buildPolicyPreviewMessage(input: {
  prepared: PreparedWalletWrap;
  compactInstructions: CompactInstructionArgs[];
  remainingAccounts: AccountMeta[];
  executeAccounts: WalletExecuteAccounts;
}): V1DecompiledMessage {
  const { prepared, executeAccounts } = input;
  const previewIx = getPreviewExecuteInstruction({
    phygitalToken: executeAccounts.phygitalToken,
    policy: executeAccounts.policy,
    wallet: executeAccounts.wallet,
    compactInstructions: input.compactInstructions,
    origin: pageOrigin() ?? null,
  });
  const instructions = [
    withRemainingAccounts(previewIx, input.remainingAccounts),
    ...prepared.memoInstructions,
  ];
  return applyPlaceholderResourceLimits(
    withFeePayerIfWallet(
      asV1TransactionMessage({
        ...prepared.decompiled,
        instructions,
      } as DecompiledMessage),
      executeAccounts.wallet,
      executeAccounts.feePayer,
    ),
  );
}

/**
 * Policy-only sim (`sigVerify: false`). Passing ends in `PreviewPassed`; any
 * other failure is what the tap would hit. Does not measure CU for the final wrap.
 */
async function assertPolicyPreviewSucceeds(
  rpc: Rpc<SolanaRpcApi>,
  message: V1DecompiledMessage,
  abortSignal?: AbortSignal,
): Promise<void> {
  const wire = getBase64EncodedWireTransaction(
    compileTransaction(message as Parameters<typeof compileTransaction>[0]),
  );
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      replaceRecentBlockhash: true,
      sigVerify: false,
    })
    .send({ abortSignal });

  if (!value.err) {
    // Only a program without `preview_execute`'s final error could land it.
    throw new Error(
      "Policy preview did not report a result: the phygital-token program is out of date",
    );
  }
  const solanaError = getSolanaErrorFromTransactionError(value.err);
  if (isPreviewPassed(solanaError, value.logs)) return;
  const denial = policyDeniedErrorFromSolanaError(solanaError, value.logs);
  if (denial) throw denial;
  throw solanaError;
}

/** Priority-fee RPC for the same writable set finalize would price. */
function fetchPriorityFeeMicroLamports(
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

function applyFeePayerSignature(
  transaction: SignedTransaction,
  walletPda: Address,
  priorSignatures: SignaturesMap | undefined,
  feePayerSignatures: SignatureDictionary,
): SignedTransaction {
  const remainingSignatures = { ...(priorSignatures ?? {}) };
  delete remainingSignatures[walletPda];

  return {
    ...transaction,
    signatures: {
      ...remainingSignatures,
      ...feePayerSignatures,
    },
  };
}

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

/** Every key that signs the final transaction: the fee payer plus the caller's other signers. */
function countTransactionSigners(
  prepared: PreparedWalletWrap,
  walletPda: Address,
  executeAccounts: WalletExecuteAccounts,
): number {
  const signers = new Set<Address>([executeAccounts.feePayer.address]);
  for (const instruction of prepared.bodyInstructions) {
    for (const account of instruction.accounts ?? []) {
      if (isSignerRole(account.role) && account.address !== walletPda) signers.add(account.address);
    }
  }
  return signers.size;
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
