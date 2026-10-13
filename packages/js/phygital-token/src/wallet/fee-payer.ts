import {
  address,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  type Address,
  type SignatureBytes,
  type SignatureDictionary,
  type Transaction,
  type TransactionPartialSigner,
} from "@solana/kit";
import { PolicyDeniedError } from "./preview.js";

/** Revibase fee service: a pool of fee-payer keys plus each accessory's prepaid network fees. */
export const DEFAULT_FEE_PAYER_ENDPOINT = "https://portal.revibase.com/api/sponsor";

export type SponsorConfig = {
  endpoint?: string;
  fetch?: typeof fetch;
};

export type SponsorInfo = {
  feePayers: Address[];
  /** The most the fee service will sign for; sponsored transactions must stay within them. */
  limits?: { maxComputeUnitLimit: number; maxComputeUnitPriceMicroLamports: bigint };
  /** Set when asked about an accessory. */
  prepaid?: { balanceLamports: bigint; prepaidLamports: bigint };
};

const endpointOf = (config?: SponsorConfig) =>
  (config?.endpoint ?? DEFAULT_FEE_PAYER_ENDPOINT).replace(/\/+$/, "");

/** The fee-payer pool, and the accessory's prepaid network fees when `phygitalToken` is given. */
export async function fetchSponsor(
  config?: SponsorConfig & { phygitalToken?: Address; abortSignal?: AbortSignal },
): Promise<SponsorInfo> {
  const httpFetch = config?.fetch ?? fetch;
  const query = config?.phygitalToken
    ? `?accessory=${encodeURIComponent(config.phygitalToken)}`
    : "";
  const response = await httpFetch(`${endpointOf(config)}${query}`, {
    signal: config?.abortSignal,
  });
  if (!response.ok) throw new Error(`Fee service unavailable (${response.status})`);
  const body = (await response.json()) as {
    feePayers?: string[];
    maxComputeUnitLimit?: number;
    maxComputeUnitPrice?: string;
    balanceLamports?: string;
    prepaidLamports?: string;
  };
  const feePayers = (body.feePayers ?? []).map((value) => address(value));
  if (feePayers.length === 0) throw new Error("Fee service has no fee payers available");
  return {
    feePayers,
    ...(body.maxComputeUnitLimit !== undefined && body.maxComputeUnitPrice !== undefined
      ? {
          limits: {
            maxComputeUnitLimit: body.maxComputeUnitLimit,
            maxComputeUnitPriceMicroLamports: BigInt(body.maxComputeUnitPrice),
          },
        }
      : {}),
    ...(body.balanceLamports !== undefined && body.prepaidLamports !== undefined
      ? {
          prepaid: {
            balanceLamports: BigInt(body.balanceLamports),
            prepaidLamports: BigInt(body.prepaidLamports),
          },
        }
      : {}),
  };
}

/** A partial signer for one pool key: the fee service checks and signs the final bytes. */
export function createSponsorFeePayer(
  feePayer: Address,
  config?: SponsorConfig,
): TransactionPartialSigner<Address> {
  const httpFetch = config?.fetch ?? fetch;
  return {
    address: feePayer,
    signTransactions: async (
      transactions: readonly Transaction[],
      options,
    ): Promise<readonly SignatureDictionary[]> => {
      options?.abortSignal?.throwIfAborted();

      const response = await httpFetch(`${endpointOf(config)}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: transactions.map((transaction) =>
            getBase64EncodedWireTransaction(transaction),
          ),
        }),
        signal: options?.abortSignal,
      });

      const body = (await response.json().catch(() => ({}))) as {
        signatures?: string[];
        error?: string;
        code?: string;
        soft?: boolean;
        details?: Record<string, unknown>;
      };
      if (!response.ok) {
        if (body.code) {
          throw new PolicyDeniedError({
            code: body.code,
            error: body.error ?? `Sign request failed (${response.status})`,
            soft: body.soft ?? false,
            details: body.details,
          });
        }
        throw new Error(body.error ?? `Sign request failed (${response.status})`);
      }

      if (!body.signatures || body.signatures.length !== transactions.length) {
        throw new Error("Fee payer sign response missing signatures");
      }

      return body.signatures.map((signatureBase64) => {
        const signatureBytes = new Uint8Array(getBase64Encoder().encode(signatureBase64));
        if (signatureBytes.length !== 64) {
          throw new Error("Fee payer signature must be 64 bytes");
        }
        return { [feePayer]: signatureBytes as SignatureBytes } satisfies SignatureDictionary;
      });
    },
  };
}

/** One partial signer per pool key. */
export async function createSponsorFeePayers(
  config?: SponsorConfig,
): Promise<TransactionPartialSigner<Address>[]> {
  const { feePayers } = await fetchSponsor(config);
  return feePayers.map((feePayer) => createSponsorFeePayer(feePayer, config));
}

export function pickFeePayer<T>(feePayers: readonly T[]): T {
  if (feePayers.length === 0) throw new Error("No fee payers to pick from");
  return feePayers[Math.floor(Math.random() * feePayers.length)]!;
}

/** A random key from the Revibase pool. */
export async function createDefaultFeePayer(
  config?: SponsorConfig,
): Promise<TransactionPartialSigner<Address>> {
  return pickFeePayer(await createSponsorFeePayers(config));
}

/** The accessory's prepaid network fees. */
export async function fetchPrepaidFees(
  phygitalToken: Address,
  config?: SponsorConfig,
): Promise<{ balanceLamports: bigint; prepaidLamports: bigint }> {
  const { prepaid } = await fetchSponsor({ ...config, phygitalToken });
  if (!prepaid) throw new Error("Fee service did not report prepaid fees");
  return prepaid;
}
