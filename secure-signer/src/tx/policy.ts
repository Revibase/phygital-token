/**
 * Transaction policy (§16-§19). Everything security-sensitive is derived from
 * the SIGNER's own kit decode — never from parent-supplied descriptions (§17).
 *
 * Guarantees enforced here:
 *  - every top-level program is on the allowlist: phygital-token (link, unlink,
 *    execute_with_owner, update_policy, close_policy), ATA createIdempotent,
 *    ComputeBudget, and the secp256r1 precompile only beside a link;
 *  - the authenticated wallet is a REQUIRED SIGNER of the transaction (§34/§15);
 *  - every signing role of every instruction (owner, recipient) is the
 *    authenticated wallet, so it never co-signs someone else's operation.
 *    Who pays the fee, and who funds tap-payments rent, may be anyone (a
 *    Revibase fee payer when the wallet can't): neither puts this key at risk,
 *    and both are shown.
 * The inner instructions of execute_with_owner are DISPLAYED, not blocked: the
 * owner may do anything with its accessory wallet.
 */

import {
  getAddressDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessagePriorityFeeLamports,
} from "@solana/kit";
import type { ErrorCode } from "../protocol.js";
import type { DecodedTransaction } from "./decode.js";
import {
  COMPUTE_BUDGET_PROGRAM,
  parseInstruction,
  SECP256R1_PROGRAM,
  type ParsedInstructionSummary,
} from "./parser.js";

const addr = getAddressDecoder();

/** Default compute budget per instruction when the transaction doesn't set one. */
const DEFAULT_UNITS_PER_INSTRUCTION = 200_000n;

export interface TransactionSummary {
  walletAddress: string;
  /** Who pays the network fee. */
  feePayer: string;
  /** Revibase's fee payers (from the fee service), so the UI can name them; absent if it couldn't be reached. */
  revibaseFeePayers?: readonly string[];
  instructions: ParsedInstructionSummary[];
  config: { priorityFeeLamports?: bigint; computeUnitLimit?: number };
  /** Signatures the fee is charged for: the transaction's own plus each secp256r1 one. */
  signatureCount: number;
}

export type PolicyResult =
  { ok: true; summary: TransactionSummary } | { ok: false; code: ErrorCode };

function readU32(data: Uint8Array, o: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint32(o, true);
}
function readU64(data: Uint8Array, o: number): bigint {
  return new DataView(data.buffer, data.byteOffset).getBigUint64(o, true);
}

function computeBudget(tx: DecodedTransaction): TransactionSummary["config"] | null {
  if (tx.message.version === 1) {
    // v1 carries these in the message config; unset ones aren't settings to show.
    const limit = getTransactionMessageComputeUnitLimit(tx.message);
    const priority = getTransactionMessagePriorityFeeLamports(tx.message);
    return {
      ...(limit ? { computeUnitLimit: limit } : {}),
      ...(priority ? { priorityFeeLamports: priority } : {}),
    };
  }
  let limit: number | undefined;
  let microLamports: bigint | undefined;
  let other = 0;
  for (const ix of tx.message.instructions) {
    if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM) {
      other++;
      continue;
    }
    const data = Uint8Array.from(ix.data ?? []);
    if (data[0] === 2 && data.length === 5) limit = readU32(data, 1);
    else if (data[0] === 3 && data.length === 9) microLamports = readU64(data, 1);
    else return null;
  }
  const units = limit !== undefined ? BigInt(limit) : DEFAULT_UNITS_PER_INSTRUCTION * BigInt(other);
  return {
    ...(limit !== undefined ? { computeUnitLimit: limit } : {}),
    ...(microLamports !== undefined
      ? { priorityFeeLamports: (microLamports * units + 999_999n) / 1_000_000n }
      : {}),
  };
}

/** Allowlist + decode for the confirm UI before the wallet key is known (cold-start restore). */
export function previewPolicy(tx: DecodedTransaction): PolicyResult {
  const summaries: ParsedInstructionSummary[] = [];
  let verifies = 0;
  let precompileSignatures = 0;
  for (const ix of tx.message.instructions) {
    if (ix.programAddress === SECP256R1_PROGRAM) {
      verifies++;
      precompileSignatures += ix.data?.[0] ?? 0;
    }
    let summary: ParsedInstructionSummary | null;
    try {
      summary = parseInstruction(ix, { feePayer: tx.message.feePayer.address });
    } catch {
      return { ok: false, code: "POLICY_REJECTED" };
    }
    if (summary) summaries.push(summary);
  }
  if (summaries.length === 0) return { ok: false, code: "POLICY_REJECTED" };
  // A secp256r1 verify only ever accompanies the link it authorizes.
  if (verifies > 1 || (verifies === 1 && !summaries.some((s) => s.kind === "link"))) {
    return { ok: false, code: "POLICY_REJECTED" };
  }

  const walletAddress = summaries[0]!.signers[0]!;
  if (summaries.some((s) => s.signers.some((signer) => signer !== walletAddress))) {
    return { ok: false, code: "POLICY_REJECTED" };
  }
  const config = computeBudget(tx);
  if (!config) return { ok: false, code: "POLICY_REJECTED" };

  const signatureCount = Object.keys(tx.transaction.signatures).length + precompileSignatures;
  return {
    ok: true,
    summary: {
      walletAddress,
      feePayer: tx.message.feePayer.address,
      instructions: summaries,
      config,
      signatureCount,
    },
  };
}

export function evaluatePolicy(tx: DecodedTransaction, walletPubkey: Uint8Array): PolicyResult {
  const preview = previewPolicy(tx);
  if (!preview.ok) return preview;

  const walletAddress = addr.decode(walletPubkey);
  if (!(walletAddress in tx.transaction.signatures)) return { ok: false, code: "WALLET_MISMATCH" };
  if (preview.summary.walletAddress !== walletAddress)
    return { ok: false, code: "POLICY_REJECTED" };
  return preview;
}
