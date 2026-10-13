/**
 * Message plumbing for the wallet wrap: v1 conversion, lifetime, fee-payer swap,
 * assembling the `execute_with_accessory` message, and signer bookkeeping.
 */
import {
  isTransactionMessageWithBlockhashLifetime,
  isSignerRole,
  isWritableRole,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountMeta,
  type Address,
  type Instruction,
  type SignatureDictionary,
  type SignaturesMap,
  type Transaction,
  type TransactionSigner,
} from "@solana/kit";
import {
  getExecuteWithAccessoryInstruction,
  type Secp256r1VerifyArgsArgs,
} from "../../generated/index.js";
import { withRemainingAccounts } from "../compile.js";
import type {
  BlockContext,
  DecompiledMessage,
  PendingWalletWrap,
  PreparedWalletWrap,
  SignedTransaction,
  V1DecompiledMessage,
  WalletExecuteAccounts,
} from "./types.js";

/** Refresh the tx blockhash when fewer than this many slots remain (~25s at 400ms). */
const MIN_BLOCKHASH_REMAINING_SLOTS = 64n;

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

export function collectWritableAddresses(message: DecompiledMessage): Address[] {
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

export function applyBlockhashIfNeeded<T extends DecompiledMessage>(
  message: T,
  block: BlockContext,
): T {
  if (!isTransactionMessageWithBlockhashLifetime(message)) {
    return message;
  }

  const { lastValidBlockHeight } = message.lifetimeConstraint;
  if (lastValidBlockHeight > block.lastValidBlockHeight + MIN_BLOCKHASH_REMAINING_SLOTS) {
    return message;
  }

  return setTransactionMessageLifetimeUsingBlockhash(block, message) as T;
}

export function withLifetimeConstraint(
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
export function withFeePayerIfWallet<T extends DecompiledMessage>(
  message: T,
  walletPda: Address,
  feePayer: TransactionSigner,
): T {
  if (message.feePayer?.address !== walletPda) {
    return message;
  }
  return setTransactionMessageFeePayerSigner(feePayer, message) as T;
}

export function applyFeePayerSignature(
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

/** Every key that signs the final transaction: the fee payer plus the caller's other signers. */
export function countTransactionSigners(
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

/** Account metas for execute don't depend on the passkey payload. */
const PLACEHOLDER_SECP_ARGS: Secp256r1VerifyArgsArgs = {
  verifyArgsRelativeIndex: 0,
  signedMessageIndex: 0,
  clientDataJson: new Uint8Array(0),
};

/**
 * Post fee-payer-swap wrap message for CU / fee account selection.
 * Omit secp to price fees before the passkey tap.
 */
export function buildWrappedBaseMessage(input: {
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
