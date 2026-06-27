import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { fetchAsset } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../instructions/mint.js";
import { findAssetPda } from "./pdas/asset.js";

type DasAssetAttribute = {
  trait_type?: string;
  value?: string | number;
};

type DasAsset = {
  id: string;
  grouping?: Array<[string, string] | { group_key: string; group_value: string }>;
  token_info?: {
    balance?: number;
    decimals?: number;
  };
  content?: {
    metadata?: {
      attributes?: DasAssetAttribute[];
    };
  };
};

type SearchAssetsParams = {
  ownerAddress: string;
  tokenType: "fungible" | "nonFungible" | "regularNft" | "compressedNft" | "all";
  page?: number;
  limit?: number;
};

type SearchAssetsResult = {
  total: number;
  limit: number;
  page: number;
  items: DasAsset[];
};

type SearchAssetsFn = (params: SearchAssetsParams) => Promise<SearchAssetsResult>;

/** String comparison on `mint` or `collection` (`=`, `!=`, `IN`, `NOT IN`). */
type GatingStringOp =
  | { op: "eq"; value: string }
  | { op: "neq"; value: string }
  | { op: "in"; values: readonly string[] }
  | { op: "notIn"; values: readonly string[] };

/** Trait comparison on a single `trait_type`. */
type GatingTraitOp =
  | { op: "eq"; value: string | number }
  | { op: "neq"; value: string | number }
  | { op: "in"; values: readonly (string | number)[] }
  | { op: "notIn"; values: readonly (string | number)[] }
  | { op: "gte"; value: number }
  | { op: "lte"; value: number }
  | { op: "between"; min: number; max: number };

type GatingTrait = {
  trait_type: string;
} & GatingTraitOp;

/** Require all or any of the listed traits on the same asset. */
type GatingTraits =
  | { all: readonly GatingTrait[] }
  | { any: readonly GatingTrait[] };

/** Raw token balance range for a single asset row (raw units, not UI amount). */
type GatingBalance = {
  min?: bigint;
  max?: bigint;
};

/**
 * Per-asset predicate — every field you set must match on the **same** owned asset.
 *
 * Dimensions: `collection`, `mint`, `traits`, `balance`.
 */
export type GatingAssetPredicate = {
  collection?: GatingStringOp;
  mint?: GatingStringOp;
  traits?: GatingTraits;
  balance?: GatingBalance;
};

/**
 * Composable gating filter tree.
 *
 * - {@link Gating.count} — number of matching assets (`COUNT … HAVING`; use `count(1, …)` for existence)
 * - {@link Gating.totalBalance} — summed balance for a mint across the wallet (`SUM`)
 * - {@link Gating.and} / {@link Gating.or} / {@link Gating.not} — boolean composition
 *
 * @example
 * ```ts
 * Gating.and(
 *   Gating.count(3, { collection: Gating.eq("CollectionMint...") }),
 *   Gating.count(1, {
 *     collection: Gating.eq("CollectionMint..."),
 *     traits: Gating.traitsAll(
 *       Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
 *       Gating.trait("Level", GatingTraitValue.gte(5)),
 *     ),
 *   }),
 *   Gating.totalBalance("TokenMint...", 1_000_000n),
 * );
 * ```
 */
export type GatingFilter =
  | { count: { min: number; max?: number; match: GatingAssetPredicate } }
  | { totalBalance: { mint: string; min?: bigint; max?: bigint } }
  | { and: GatingFilter[] }
  | { or: GatingFilter[] }
  | { not: GatingFilter };

export type GatingFilterResult =
  | {
      kind: "count";
      filter: {
        count: { min: number; max?: number; match: GatingAssetPredicate };
      };
      passed: boolean;
      matchCount: number;
    }
  | {
      kind: "totalBalance";
      filter: { totalBalance: { mint: string; min?: bigint; max?: bigint } };
      passed: boolean;
      total: bigint;
    }
  | {
      kind: "and";
      filter: { and: GatingFilter[] };
      passed: boolean;
      children: GatingFilterResult[];
    }
  | {
      kind: "or";
      filter: { or: GatingFilter[] };
      passed: boolean;
      children: GatingFilterResult[];
    }
  | {
      kind: "not";
      filter: { not: GatingFilter };
      passed: boolean;
      child: GatingFilterResult;
    };

export type GatingTier<TId extends string = string> = {
  id: TId;
  filter: GatingFilter;
};

export type GatingTierEvaluationResult<TId extends string = string> = {
  id: TId;
  passed: boolean;
  filterResult: GatingFilterResult;
};

export type GatingTiersEvaluationResult<TId extends string = string> = {
  tiers: GatingTierEvaluationResult<TId>[];
  /** Tier IDs whose filter passed, in declaration order. */
  passedTierIds: TId[];
  /** True when at least one tier passed. */
  passed: boolean;
};

export type GatingEvaluationResult<TId extends string = string> =
  GatingTiersEvaluationResult<TId> & {
    owner: Address;
  };

export type EvaluateAssetGatingOptions<TId extends string = string> = {
  /** Base64url-encoded secp256r1 public key for the phygital asset. */
  assetPublicKey: string;
  rpc: Rpc<SolanaRpcApi>;
  /** Tier definitions — each evaluated independently against the owner's wallet. */
  tiers: readonly GatingTier<TId>[];
};

/** Builders for {@link GatingFilter} trees and field operators. */
export const Gating = {
  and(...filters: GatingFilter[]): GatingFilter {
    return { and: filters };
  },

  or(...filters: GatingFilter[]): GatingFilter {
    return { or: filters };
  },

  not(filter: GatingFilter): GatingFilter {
    return { not: filter };
  },

  /** Named tier for multi-tier gating (e.g. bronze / silver / gold). */
  tier<TId extends string>(id: TId, filter: GatingFilter): GatingTier<TId> {
    return { id, filter };
  },

  /**
   * Number of owned assets matching the predicate (optional max = upper bound).
   * Use `count(1, …)` when you only need existence (at least one match).
   */
  count(
    min: number,
    match: GatingAssetPredicate,
    max?: number,
  ): GatingFilter {
    return { count: { min, max, match } };
  },

  /** Summed raw balance for `mint` across the wallet. */
  totalBalance(mint: string, min?: bigint, max?: bigint): GatingFilter {
    return { totalBalance: { mint, min, max } };
  },

  eq(value: string): GatingStringOp {
    return { op: "eq", value };
  },

  neq(value: string): GatingStringOp {
    return { op: "neq", value };
  },

  in(...values: string[]): GatingStringOp {
    return { op: "in", values };
  },

  notIn(...values: string[]): GatingStringOp {
    return { op: "notIn", values };
  },

  trait(trait_type: string, op: GatingTraitOp): GatingTrait {
    return { trait_type, ...op };
  },

  traitsAll(...traits: GatingTrait[]): GatingTraits {
    return { all: traits };
  },

  traitsAny(...traits: GatingTrait[]): GatingTraits {
    return { any: traits };
  },

  balance(min?: bigint, max?: bigint): GatingBalance {
    return { min, max };
  },
} as const;

/** Trait value operators — use with {@link Gating.trait}. */
export const GatingTraitValue = {
  eq(value: string | number): GatingTraitOp {
    return { op: "eq", value };
  },

  neq(value: string | number): GatingTraitOp {
    return { op: "neq", value };
  },

  in(...values: (string | number)[]): GatingTraitOp {
    return { op: "in", values };
  },

  notIn(...values: (string | number)[]): GatingTraitOp {
    return { op: "notIn", values };
  },

  gte(value: number): GatingTraitOp {
    return { op: "gte", value };
  },

  lte(value: number): GatingTraitOp {
    return { op: "lte", value };
  },

  between(min: number, max: number): GatingTraitOp {
    return { op: "between", min, max };
  },
} as const;

async function fetchAssetOwner(
  rpc: Rpc<SolanaRpcApi>,
  assetPublicKey: string,
): Promise<Address> {
  const assetPda = await findAssetPda(parseSecp256r1Pubkey(assetPublicKey));
  const account = await fetchAsset(rpc, assetPda);
  return account.data.owner;
}

function createSearchAssetsClient(rpc: Rpc<SolanaRpcApi>): SearchAssetsFn {
  return async (params) => {
    const rpcWithExecute = rpc as Rpc<SolanaRpcApi> & {
      execute: (request: {
        methodName: "searchAssets";
        params: SearchAssetsParams;
      }) => { send: () => Promise<SearchAssetsResult> };
    };

    return rpcWithExecute
      .execute({ methodName: "searchAssets", params })
      .send();
  };
}

async function fetchOwnerDasAssets(
  owner: Address,
  rpc: Rpc<SolanaRpcApi>,
): Promise<DasAsset[]> {
  const searchAssets = createSearchAssetsClient(rpc);
  const pageSize = 1000;
  const items: DasAsset[] = [];
  let page = 1;

  while (true) {
    const result = await searchAssets({
      ownerAddress: owner,
      tokenType: "all",
      page,
      limit: pageSize,
    });

    items.push(...result.items);

    if (result.items.length < pageSize) {
      break;
    }
    if (result.total > 0 && items.length >= result.total) {
      break;
    }
    page += 1;
  }

  return items;
}

function assetCollections(asset: DasAsset): string[] {
  const collections: string[] = [];
  for (const entry of asset.grouping ?? []) {
    if (Array.isArray(entry)) {
      if (entry[0] === "collection") {
        collections.push(entry[1]);
      }
      continue;
    }
    if (entry.group_key === "collection") {
      collections.push(entry.group_value);
    }
  }
  return collections;
}

function normalizeText(value: string | number): string {
  return String(value).trim().toLowerCase();
}

function parseNumericTraitValue(value: string | number): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function matchesStringOp(actual: string, op: GatingStringOp): boolean {
  switch (op.op) {
    case "eq":
      return actual === op.value;
    case "neq":
      return actual !== op.value;
    case "in":
      return op.values.includes(actual);
    case "notIn":
      return !op.values.includes(actual);
  }
}

function traitEntriesForType(
  asset: DasAsset,
  traitType: string,
): DasAssetAttribute[] {
  const normalizedType = traitType.trim().toLowerCase();
  return (asset.content?.metadata?.attributes ?? []).filter((entry) => {
    return (
      entry.trait_type !== undefined &&
      entry.value !== undefined &&
      entry.trait_type.trim().toLowerCase() === normalizedType
    );
  });
}

function matchesTraitOp(asset: DasAsset, trait: GatingTrait): boolean {
  const entries = traitEntriesForType(asset, trait.trait_type);

  switch (trait.op) {
    case "eq":
      return entries.some(
        (entry) => normalizeText(entry.value!) === normalizeText(trait.value),
      );
    case "neq":
      return (
        entries.length === 0 ||
        entries.every(
          (entry) =>
            normalizeText(entry.value!) !== normalizeText(trait.value),
        )
      );
    case "in": {
      const allowed = new Set(trait.values.map(normalizeText));
      return entries.some((entry) => allowed.has(normalizeText(entry.value!)));
    }
    case "notIn": {
      const blocked = new Set(trait.values.map(normalizeText));
      return (
        entries.length === 0 ||
        entries.every((entry) => !blocked.has(normalizeText(entry.value!)))
      );
    }
    case "gte":
      return entries.some((entry) => {
        const numeric = parseNumericTraitValue(entry.value!);
        return numeric !== undefined && numeric >= trait.value;
      });
    case "lte":
      return entries.some((entry) => {
        const numeric = parseNumericTraitValue(entry.value!);
        return numeric !== undefined && numeric <= trait.value;
      });
    case "between":
      return entries.some((entry) => {
        const numeric = parseNumericTraitValue(entry.value!);
        return (
          numeric !== undefined &&
          numeric >= trait.min &&
          numeric <= trait.max
        );
      });
  }
}

function matchesTraits(asset: DasAsset, traits: GatingTraits): boolean {
  if ("all" in traits) {
    return traits.all.every((trait) => matchesTraitOp(asset, trait));
  }
  return traits.any.some((trait) => matchesTraitOp(asset, trait));
}

function assetBalance(asset: DasAsset): bigint {
  const balance = asset.token_info?.balance;
  if (balance === undefined) {
    return 0n;
  }
  return BigInt(balance);
}

function matchesBalance(asset: DasAsset, balance: GatingBalance): boolean {
  const amount = assetBalance(asset);
  if (balance.min !== undefined && amount < balance.min) {
    return false;
  }
  if (balance.max !== undefined && amount > balance.max) {
    return false;
  }
  return true;
}

export function assetMatchesPredicate(
  asset: DasAsset,
  predicate: GatingAssetPredicate,
): boolean {
  if (predicate.mint !== undefined && !matchesStringOp(asset.id, predicate.mint)) {
    return false;
  }

  if (predicate.collection !== undefined) {
    const collections = assetCollections(asset);
    if (!collections.some((collection) => matchesStringOp(collection, predicate.collection!))) {
      return false;
    }
  }

  if (predicate.traits !== undefined && !matchesTraits(asset, predicate.traits)) {
    return false;
  }

  if (predicate.balance !== undefined && !matchesBalance(asset, predicate.balance)) {
    return false;
  }

  return true;
}

function countMatchingAssets(
  assets: DasAsset[],
  predicate: GatingAssetPredicate,
): number {
  return assets.filter((asset) => assetMatchesPredicate(asset, predicate)).length;
}

function countInRange(count: number, min: number, max?: number): boolean {
  if (count < min) {
    return false;
  }
  if (max !== undefined && count > max) {
    return false;
  }
  return true;
}

function amountInRange(amount: bigint, min?: bigint, max?: bigint): boolean {
  if (min !== undefined && amount < min) {
    return false;
  }
  if (max !== undefined && amount > max) {
    return false;
  }
  return true;
}

function totalBalanceForMint(assets: DasAsset[], mint: string): bigint {
  let total = 0n;
  for (const asset of assets) {
    if (asset.id === mint) {
      total += assetBalance(asset);
    }
  }
  return total;
}

export function evaluateGatingFilter(
  assets: DasAsset[],
  filter: GatingFilter,
): GatingFilterResult {
  if ("count" in filter) {
    const matchCount = countMatchingAssets(assets, filter.count.match);
    return {
      kind: "count",
      filter,
      matchCount,
      passed: countInRange(
        matchCount,
        filter.count.min,
        filter.count.max,
      ),
    };
  }

  if ("totalBalance" in filter) {
    const total = totalBalanceForMint(assets, filter.totalBalance.mint);
    return {
      kind: "totalBalance",
      filter,
      total,
      passed: amountInRange(
        total,
        filter.totalBalance.min,
        filter.totalBalance.max,
      ),
    };
  }

  if ("and" in filter) {
    const children = filter.and.map((child) => evaluateGatingFilter(assets, child));
    return {
      kind: "and",
      filter,
      passed: children.every((child) => child.passed),
      children,
    };
  }

  if ("or" in filter) {
    const children = filter.or.map((child) => evaluateGatingFilter(assets, child));
    return {
      kind: "or",
      filter,
      passed: children.some((child) => child.passed),
      children,
    };
  }

  if ("not" in filter) {
    const child = evaluateGatingFilter(assets, filter.not);
    return {
      kind: "not",
      filter,
      passed: !child.passed,
      child,
    };
  }

  throw new Error("Invalid gating filter.");
}

function formatGatingStringOp(field: string, op: GatingStringOp): string {
  switch (op.op) {
    case "eq":
      return `${field} = ${op.value}`;
    case "neq":
      return `${field} != ${op.value}`;
    case "in":
      return `${field} in (${op.values.join(", ")})`;
    case "notIn":
      return `${field} not in (${op.values.join(", ")})`;
  }
}

function formatGatingTraitOp(op: GatingTraitOp): string {
  switch (op.op) {
    case "eq":
      return `= ${op.value}`;
    case "neq":
      return `!= ${op.value}`;
    case "in":
      return `in (${op.values.join(", ")})`;
    case "notIn":
      return `not in (${op.values.join(", ")})`;
    case "gte":
      return `>= ${op.value}`;
    case "lte":
      return `<= ${op.value}`;
    case "between":
      return `between ${op.min} and ${op.max}`;
  }
}

function formatGatingTrait(trait: GatingTrait): string {
  return `${trait.trait_type} ${formatGatingTraitOp(trait)}`;
}

/** Human-readable description of a per-asset predicate. */
export function formatGatingPredicate(predicate: GatingAssetPredicate): string {
  const parts: string[] = [];

  if (predicate.collection !== undefined) {
    parts.push(formatGatingStringOp("collection", predicate.collection));
  }
  if (predicate.mint !== undefined) {
    parts.push(formatGatingStringOp("mint", predicate.mint));
  }
  if (predicate.traits !== undefined) {
    if ("all" in predicate.traits) {
      parts.push(
        `traits all [${predicate.traits.all.map(formatGatingTrait).join("; ")}]`,
      );
    } else {
      parts.push(
        `traits any [${predicate.traits.any.map(formatGatingTrait).join("; ")}]`,
      );
    }
  }
  if (predicate.balance !== undefined) {
    const { min, max } = predicate.balance;
    if (min !== undefined && max !== undefined) {
      parts.push(`balance between ${min} and ${max}`);
    } else if (min !== undefined) {
      parts.push(`balance >= ${min}`);
    } else if (max !== undefined) {
      parts.push(`balance <= ${max}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : "any asset";
}

function describeSatisfiedCondition(result: GatingFilterResult): string {
  switch (result.kind) {
    case "count":
      return `${result.matchCount} asset(s) matching ${formatGatingPredicate(result.filter.count.match)}`;
    case "totalBalance":
      return `balance ${result.total} for mint ${result.filter.totalBalance.mint}`;
    case "and":
      return result.children.map(describeSatisfiedCondition).join("; ");
    case "or": {
      const passedChild = result.children.find((child) => child.passed);
      return passedChild
        ? describeSatisfiedCondition(passedChild)
        : "an alternative condition";
    }
    case "not":
      return `not (${describeSatisfiedCondition(result.child)})`;
  }
}

function summarizeFailedNode(result: GatingFilterResult): string[] {
  switch (result.kind) {
    case "count": {
      const { min, max, match } = result.filter.count;
      const predicate = formatGatingPredicate(match);
      const lines: string[] = [];

      if (result.matchCount < min) {
        lines.push(
          `Need at least ${min} asset(s) matching ${predicate}; found ${result.matchCount}.`,
        );
      }
      if (max !== undefined && result.matchCount > max) {
        lines.push(
          `Need at most ${max} asset(s) matching ${predicate}; found ${result.matchCount}.`,
        );
      }
      if (lines.length === 0) {
        lines.push(
          `Asset count requirement not met for ${predicate} (found ${result.matchCount}).`,
        );
      }
      return lines;
    }
    case "totalBalance": {
      const { mint, min, max } = result.filter.totalBalance;
      const lines: string[] = [];

      if (min !== undefined && result.total < min) {
        lines.push(
          `Need at least ${min} raw balance for mint ${mint}; found ${result.total}.`,
        );
      }
      if (max !== undefined && result.total > max) {
        lines.push(
          `Need at most ${max} raw balance for mint ${mint}; found ${result.total}.`,
        );
      }
      if (lines.length === 0) {
        lines.push(
          `Balance requirement not met for mint ${mint} (found ${result.total}).`,
        );
      }
      return lines;
    }
    case "and":
      return result.children.flatMap((child) => summarizeGatingFailure(child));
    case "or":
      return [
        "None of the alternative conditions were met:",
        ...result.children.flatMap((child, index) =>
          summarizeGatingFailure(child).map((line) => `  [${index + 1}] ${line}`),
        ),
      ];
    case "not":
      return [
        `Must not satisfy: ${describeSatisfiedCondition(result.child)}.`,
      ];
  }
}

/**
 * Returns human-readable reasons why a filter result failed.
 * Empty when `result.passed` is true.
 */
export function summarizeGatingFailure(result: GatingFilterResult): string[] {
  if (result.passed) {
    return [];
  }
  return summarizeFailedNode(result);
}

/** Convenience wrapper around {@link summarizeGatingFailure} for a single tier result. */
export function summarizeGatingTierFailure(
  tier: GatingTierEvaluationResult,
): string[] {
  return summarizeGatingFailure(tier.filterResult);
}

/**
 * Returns human-readable reasons why gating failed.
 * When no tier passed, summarizes every failed tier. Otherwise returns [].
 */
export function summarizeGatingEvaluationFailure<TId extends string>(
  result: GatingTiersEvaluationResult<TId> | GatingEvaluationResult<TId>,
): string[] {
  if (result.passed) {
    return [];
  }

  return result.tiers.flatMap((tier) => {
    const reasons = summarizeGatingTierFailure(tier);
    if (reasons.length === 0) {
      return [];
    }
    return [`Tier "${tier.id}":`, ...reasons.map((line) => `  ${line}`)];
  });
}

export function evaluateGatingTiers<TId extends string>(
  assets: DasAsset[],
  tiers: readonly GatingTier<TId>[],
): GatingTiersEvaluationResult<TId> {
  const tierResults: GatingTierEvaluationResult<TId>[] = tiers.map((tier) => {
    const filterResult = evaluateGatingFilter(assets, tier.filter);
    return {
      id: tier.id,
      passed: filterResult.passed,
      filterResult,
    };
  });

  const passedTierIds = tierResults
    .filter((tier) => tier.passed)
    .map((tier) => tier.id);

  return {
    tiers: tierResults,
    passedTierIds,
    passed: passedTierIds.length > 0,
  };
}

/**
 * Gate access based on what else a phygital asset's owner holds on-chain.
 *
 * 1. Looks up the asset owner from the secp256r1 public key.
 * 2. Loads the owner's DAS assets via `searchAssets`.
 * 3. Evaluates each tier filter independently.
 *
 * Requires a DAS-capable RPC (e.g. Helius) — the same `rpc` used for
 * `fetchAsset` is reused for `searchAssets` via `rpc.execute`.
 *
 * @example
 * ```ts
 * await evaluateAssetGating({
 *   assetPublicKey,
 *   rpc,
 *   tiers: [
 *     Gating.tier("bronze", Gating.count(1, { collection: Gating.eq("Col...") })),
 *     Gating.tier("silver", Gating.count(3, { collection: Gating.eq("Col...") })),
 *     Gating.tier("gold", Gating.count(1, {
 *       collection: Gating.eq("Col..."),
 *       traits: Gating.traitsAll(Gating.trait("Rarity", GatingTraitValue.eq("Gold"))),
 *     })),
 *   ],
 * });
 * ```
 */
export async function evaluateAssetGating<TId extends string>(
  options: EvaluateAssetGatingOptions<TId>,
): Promise<GatingEvaluationResult<TId>> {
  const { assetPublicKey, rpc, tiers } = options;

  const owner = await fetchAssetOwner(rpc, assetPublicKey);
  const assets = await fetchOwnerDasAssets(owner, rpc);
  const tierEvaluation = evaluateGatingTiers(assets, tiers);

  return {
    ...tierEvaluation,
    owner,
  };
}
