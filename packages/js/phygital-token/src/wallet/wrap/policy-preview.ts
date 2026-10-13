/**
 * Simulates `preview_execute` before the tap, so a transaction the policy would
 * refuse fails with a readable reason before the user taps.
 */
import {
  compileTransaction,
  getBase64EncodedWireTransaction,
  getSolanaErrorFromTransactionError,
  type AccountMeta,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  getPreviewExecuteInstruction,
  type CompactInstructionArgs,
} from "../../generated/index.js";
import { withRemainingAccounts } from "../compile.js";
import { isPreviewPassed, policyDeniedErrorFromSolanaError } from "../preview.js";
import type {
  DecompiledMessage,
  PreparedWalletWrap,
  V1DecompiledMessage,
  WalletExecuteAccounts,
} from "./types.js";
import { asV1TransactionMessage, withFeePayerIfWallet } from "./message.js";
import { applyPlaceholderResourceLimits } from "./budget.js";

/** The page origin the browser will put in the tap's `clientDataJSON`, if any. */
function pageOrigin(): string | undefined {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return typeof location?.origin === "string" ? location.origin : undefined;
}

/**
 * `preview_execute` in place of `execute_with_accessory`: every check a tap
 * faces except the tap itself — this page's origin, then the policy. It never lands.
 */
export function buildPolicyPreviewMessage(input: {
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
export async function assertPolicyPreviewSucceeds(
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
