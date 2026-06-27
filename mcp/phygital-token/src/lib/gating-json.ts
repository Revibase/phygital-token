import type { GatingFilter, GatingTier } from "phygital-token-sdk";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | bigint
  | JsonValue[]
  | { [key: string]: JsonValue };

function reviveBigInts(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(reviveBigInts);
  }

  if (value && typeof value === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "min" || key === "max") {
        if (typeof child === "string" && /^-?\d+n?$/.test(child)) {
          next[key] = BigInt(child.replace(/n$/, ""));
          continue;
        }
        if (typeof child === "number" && Number.isInteger(child)) {
          next[key] = BigInt(child);
          continue;
        }
      }
      next[key] = reviveBigInts(child);
    }
    return next;
  }

  return value;
}

export function parseGatingFilter(raw: unknown): GatingFilter {
  if (!raw || typeof raw !== "object") {
    throw new Error("filter must be a JSON object (GatingFilter tree).");
  }
  return reviveBigInts(raw as JsonValue) as GatingFilter;
}

export function parseGatingTiers(raw: unknown): GatingTier[] {
  if (!Array.isArray(raw)) {
    throw new Error("tiers must be a JSON array of { id, filter } objects.");
  }

  const tiers: GatingTier[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("Each tier must be an object with id and filter.");
    }

    const { id, filter } = item as { id?: unknown; filter?: unknown };

    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Each tier requires a non-empty string id.");
    }

    tiers.push({
      id,
      filter: parseGatingFilter(filter),
    });
  }

  return tiers;
}

export const GATING_FILTER_SCHEMA = {
  description: "Composable GatingFilter tree evaluated against wallet DAS assets",
  predicate: {
    description: "Per-asset match — all set fields must match the SAME owned asset row",
    fields: {
      collection: '{ op: "eq"|"neq"|"in"|"notIn", value?: string, values?: string[] }',
      mint: "same as collection",
      traits: '{ all: GatingTrait[] } | { any: GatingTrait[] }',
      balance: '{ min?: bigint|string, max?: bigint|string } — raw token units',
    },
    trait: '{ trait_type: string, op: "eq"|"neq"|"in"|"notIn"|"gte"|"lte"|"between", value?, values?, min?, max? }',
  },
  filterKinds: {
    count: '{ count: { min: number, max?: number, match: GatingAssetPredicate } }',
    totalBalance: '{ totalBalance: { mint: string, min?: bigint|string, max?: bigint|string } }',
    and: '{ and: GatingFilter[] }',
    or: '{ or: GatingFilter[] }',
    not: '{ not: GatingFilter }',
  },
  tier: '{ id: string, filter: GatingFilter }',
  sdkBuilders: {
    Gating: ["and", "or", "not", "tier", "count", "totalBalance", "eq", "neq", "in", "notIn", "trait", "traitsAll", "traitsAny", "balance"],
    GatingTraitValue: ["eq", "neq", "in", "notIn", "gte", "lte", "between"],
  },
} as const;

export const GATING_TIER_EXAMPLE = [
  {
    id: "bronze",
    filter: {
      count: {
        min: 1,
        match: {
          collection: { op: "eq", value: "CollectionMintAddress..." },
        },
      },
    },
  },
  {
    id: "silver",
    filter: {
      count: {
        min: 3,
        match: {
          collection: { op: "eq", value: "CollectionMintAddress..." },
        },
      },
    },
  },
  {
    id: "gold",
    filter: {
      and: [
        {
          count: {
            min: 1,
            match: {
              collection: { op: "eq", value: "CollectionMintAddress..." },
              traits: {
                all: [
                  { trait_type: "Rarity", op: "eq", value: "Gold" },
                  { trait_type: "Level", op: "gte", value: 10 },
                ],
              },
            },
          },
        },
        {
          totalBalance: { mint: "RewardTokenMint...", min: "10000000" },
        },
      ],
    },
  },
];

export type GatingRecipe = {
  id: string;
  title: string;
  description: string;
  filter?: unknown;
  tiers?: unknown;
  footgun?: boolean;
};

export const GATING_RECIPES: GatingRecipe[] = [
  {
    id: "collection_any",
    title: "Hold any NFT from a collection",
    description: "At least one asset from collection mint",
    filter: {
      count: {
        min: 1,
        match: { collection: { op: "eq", value: "CollectionMint..." } },
      },
    },
  },
  {
    id: "specific_mint",
    title: "Hold a specific NFT mint",
    description: "Wallet owns a particular mint",
    filter: {
      count: { min: 1, match: { mint: { op: "eq", value: "NftMint..." } } },
    },
  },
  {
    id: "collection_count_n",
    title: "Hold N NFTs from a collection",
    description: "Minimum count from same collection",
    filter: {
      count: {
        min: 5,
        match: { collection: { op: "eq", value: "CollectionMint..." } },
      },
    },
  },
  {
    id: "gold_trait_same_nft",
    title: "Gold trait on same NFT",
    description: "Traits must match on one asset row",
    filter: {
      count: {
        min: 1,
        match: {
          collection: { op: "eq", value: "CollectionMint..." },
          traits: {
            all: [{ trait_type: "Rarity", op: "eq", value: "Gold" }],
          },
        },
      },
    },
  },
  {
    id: "gold_or_platinum",
    title: "Gold OR Platinum on same NFT",
    description: "traits.any for alternates on one asset",
    filter: {
      count: {
        min: 1,
        match: {
          collection: { op: "eq", value: "CollectionMint..." },
          traits: {
            any: [{ trait_type: "Rarity", op: "in", values: ["Gold", "Platinum"] }],
          },
        },
      },
    },
  },
  {
    id: "min_token_balance",
    title: "Minimum wallet token balance",
    description: "Summed raw balance across wallet for a mint",
    filter: {
      totalBalance: { mint: "TokenMint...", min: "1000000" },
    },
  },
  {
    id: "mint_a_and_mint_b",
    title: "Hold mint A and mint B (any two assets)",
    description: "Use and + two count(1) — different assets OK",
    filter: {
      and: [
        { count: { min: 1, match: { mint: { op: "eq", value: "MintA..." } } } },
        { count: { min: 1, match: { mint: { op: "eq", value: "MintB..." } } } },
      ],
    },
  },
  {
    id: "vip_or_collection_plus_balance",
    title: "VIP pass OR (collection + token balance)",
    description: "or composition for alternative unlock paths",
    filter: {
      or: [
        { count: { min: 1, match: { mint: { op: "eq", value: "VIPPassMint..." } } } },
        {
          and: [
            {
              count: {
                min: 1,
                match: { collection: { op: "eq", value: "CollectionMint..." } },
              },
            },
            { totalBalance: { mint: "TokenMint...", min: "5000000" } },
          ],
        },
      ],
    },
  },
  {
    id: "exclude_banned_collection",
    title: "Exclude banned collection",
    description: "not + count(1)",
    filter: {
      not: {
        count: {
          min: 1,
          match: { collection: { op: "eq", value: "BannedCol..." } },
        },
      },
    },
  },
  {
    id: "bronze_silver_gold_tiers",
    title: "Bronze / silver / gold tiers",
    description: "Multi-tier evaluateAssetGating config",
    tiers: GATING_TIER_EXAMPLE,
  },
  {
    id: "footgun_traits_split_nfts",
    title: "FOOTGUN: traits split across NFTs",
    description: "WRONG — requires one NFT to be both Gold and Silver",
    footgun: true,
    filter: {
      count: {
        min: 1,
        match: {
          traits: {
            all: [
              { trait_type: "Rarity", op: "eq", value: "Gold" },
              { trait_type: "Rarity", op: "eq", value: "Silver" },
            ],
          },
        },
      },
    },
  },
  {
    id: "footgun_two_counts_for_traits",
    title: "FOOTGUN: two count(1) for traits on one NFT",
    description: "WRONG — checks two different assets. Use traitsAll on one predicate.",
    footgun: true,
    filter: {
      and: [
        {
          count: {
            min: 1,
            match: {
              traits: { all: [{ trait_type: "Rarity", op: "eq", value: "Gold" }] },
            },
          },
        },
        {
          count: {
            min: 1,
            match: {
              traits: { all: [{ trait_type: "Level", op: "gte", value: 5 }] },
            },
          },
        },
      ],
    },
  },
  {
    id: "footgun_ui_decimals_in_balance",
    title: "FOOTGUN: UI decimals in balance",
    description: "WRONG for 6-decimal token — use raw units (1 USDC = 1000000)",
    footgun: true,
    filter: {
      totalBalance: { mint: "USDC...", min: "1" },
    },
  },
];

export function getGatingRecipe(id: string): GatingRecipe {
  const recipe = GATING_RECIPES.find((r) => r.id === id);
  if (!recipe) {
    throw new Error(
      `Unknown recipe "${id}". Use list_gating_recipes for available ids.`,
    );
  }
  return recipe;
}

export const GATING_OVERVIEW = {
  question: "Given what this phygital asset owner holds in their wallet, do they qualify?",
  flow: [
    "1. Resolve owner from asset secp256r1 public key (on-chain asset account)",
    "2. Paginate DAS searchAssets for that owner (NFTs, cNFTs, fungible)",
    "3. Evaluate filter tree(s) against loaded assets",
  ],
  dimensions: [
    { field: "collection", source: "DAS grouping key=collection", example: "hold any NFT from collection" },
    { field: "mint", source: "DAS asset id", example: "hold specific NFT/token mint" },
    { field: "traits", source: "metadata.attributes", example: "Rarity=Gold on same NFT" },
    { field: "balance", source: "token_info.balance raw units", example: "min balance on asset row" },
  ],
  aggregations: [
    { api: "Gating.count(min, predicate, max?)", analogue: "COUNT … HAVING — use count(1,…) for existence" },
    { api: "Gating.totalBalance(mint, min?, max?)", analogue: "SUM(balance) wallet-wide for mint" },
    { api: "Gating.and / or / not", analogue: "boolean composition" },
  ],
  sameAssetVsWallet: [
    {
      intent: "One NFT has Gold AND Level >= 5",
      correct: "Single predicate with traits: Gating.traitsAll(...)",
    },
    {
      intent: "Wallet holds mint A AND mint B",
      correct: "Gating.and(Gating.count(1,{mint:A}), Gating.count(1,{mint:B}))",
    },
  ],
  requirements: ["DAS-capable RPC (Helius)", "assetPublicKey base64url secp256r1 pubkey"],
  docIds: [
    "gating:README",
    "gating:overview",
    "gating:predicates",
    "gating:filters-and-composition",
    "gating:tiers",
    "gating:evaluation-and-errors",
    "gating:recipes",
  ],
} as const;
