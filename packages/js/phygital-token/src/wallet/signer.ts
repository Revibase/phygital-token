import type {
  Address,
  Rpc,
  SolanaRpcApi,
  Transaction,
  TransactionModifyingSigner,
  TransactionPartialSigner,
} from "@solana/kit";
import { isTransactionWithDurableNonceLifetime } from "@solana/kit";
import { authenticatePasskeyForSecp256r1Verify } from "../instructions/verify.js";
import { findPolicyPda, findWalletPda } from "../generated/index.js";
import {
  createSponsorFeePayer,
  DEFAULT_FEE_PAYER_ENDPOINT,
  fetchSponsor,
  pickFeePayer,
} from "./fee-payer.js";
import { modifyAndWrapWalletTransaction, type FeePlan } from "./wrap-transaction.js";

export type PhygitalWalletSignPhase =
  "preparing" | "previewing" | "awaitingPasskey" | "building" | "feePaying" | "complete";

export type PhygitalWalletSignerCallbacks = {
  onPhaseChange?: (phase: PhygitalWalletSignPhase) => void;
  /** Where this transaction's network fee comes from, before the passkey prompt. Revibase fee payers only. */
  onFeePlan?: (plan: FeePlan) => void;
};

export type PhygitalWalletSignerConfig = PhygitalWalletSignerCallbacks & {
  fetch?: typeof fetch;
  /**
   * Your own fee payer(s); one is picked per transaction. Omit to use the
   * Revibase pool, which draws on the accessory's prepaid network fees and
   * refills them from the accessory wallet when they run low.
   */
  feePayer?: TransactionPartialSigner | readonly TransactionPartialSigner[];
  /** The Revibase fee service. */
  feeEndpoint?: string;
};

/** Where the owner manages an accessory (refills its network fees, edits tap payments). */
const manageUrl = (phygitalToken: Address) => `https://portal.revibase.com/wallet/${phygitalToken}`;

export function assertSupportedTransactionLifetime(transaction: Transaction): void {
  if (isTransactionWithDurableNonceLifetime(transaction)) {
    throw new Error(
      "getPhygitalWalletSigner does not support durable nonce transactions; use a recent blockhash lifetime",
    );
  }
}

/**
 * Kit modifying signer for a phygital token's wallet PDA, signing with an
 * accessory tap via `execute_with_accessory`. Policy soft-denies surface as
 * {@link PolicyDeniedError} before the passkey prompt.
 */
export async function getPhygitalWalletSigner(
  rpc: Rpc<SolanaRpcApi>,
  phygitalTokenPda: Address,
  config?: PhygitalWalletSignerConfig,
): Promise<TransactionModifyingSigner> {
  // The wallet is a PDA of the token, so no account needs to be read; a missing policy surfaces as a `no_policy` denial before the tap.
  const [[wallet], [policyPda]] = await Promise.all([
    findWalletPda({ phygitalToken: phygitalTokenPda }),
    findPolicyPda({ phygitalToken: phygitalTokenPda }),
  ]);
  const ownFeePayers = config?.feePayer
    ? Array.isArray(config.feePayer)
      ? (config.feePayer as readonly TransactionPartialSigner[])
      : [config.feePayer as TransactionPartialSigner]
    : null;
  const sponsorConfig = {
    endpoint: config?.feeEndpoint ?? DEFAULT_FEE_PAYER_ENDPOINT,
    fetch: config?.fetch,
  };

  return {
    address: wallet,
    modifyAndSignTransactions: async (transactions, signConfig) => {
      signConfig?.abortSignal?.throwIfAborted();

      const [transaction] = transactions;
      if (transactions.length !== 1 || !transaction) {
        throw new Error("getPhygitalWalletSigner accepts exactly one transaction per sign");
      }
      if (!("lifetimeConstraint" in transaction)) {
        throw new Error("getPhygitalWalletSigner requires transactions with a lifetime constraint");
      }
      assertSupportedTransactionLifetime(transaction);

      config?.onPhaseChange?.("preparing");
      // Fresh every sign: the pool can change and the prepaid balance moves with each transaction.
      const sponsor = ownFeePayers
        ? null
        : await fetchSponsor({
            ...sponsorConfig,
            phygitalToken: phygitalTokenPda,
            abortSignal: signConfig?.abortSignal,
          });
      const executeAccounts = {
        feePayer: ownFeePayers
          ? pickFeePayer(ownFeePayers)
          : createSponsorFeePayer(pickFeePayer(sponsor!.feePayers), sponsorConfig),
        policy: policyPda,
        wallet,
        phygitalToken: phygitalTokenPda,
      };
      const wrapped = await modifyAndWrapWalletTransaction({
        rpc,
        transaction: transaction,
        walletPda: executeAccounts.wallet,
        executeAccounts,
        prepaidFees: sponsor?.prepaid
          ? {
              ...sponsor.prepaid,
              maxComputeUnitPriceMicroLamports: sponsor.limits?.maxComputeUnitPriceMicroLamports,
              manageUrl: manageUrl(phygitalTokenPda),
              onPlan: config?.onFeePlan,
            }
          : undefined,
        abortSignal: signConfig?.abortSignal,
        onPreview: () => config?.onPhaseChange?.("previewing"),
        authenticate: async (messageHash) => {
          config?.onPhaseChange?.("awaitingPasskey");
          const tap = await authenticatePasskeyForSecp256r1Verify({ rpc, messageHash });
          config?.onPhaseChange?.("building");
          return tap;
        },
        feePayer: async (tx) => {
          config?.onPhaseChange?.("feePaying");
          const [feePayerSignature] = await executeAccounts.feePayer.signTransactions(
            [tx],
            signConfig,
          );
          if (!feePayerSignature) {
            throw new Error("Fee payer returned no signature");
          }
          return feePayerSignature;
        },
      });

      config?.onPhaseChange?.("complete");
      return [wrapped];
    },
  };
}
