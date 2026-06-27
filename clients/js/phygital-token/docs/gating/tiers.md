# Tiers

Use tiers when you want to **segment users** (bronze / silver / gold, basic / pro / enterprise) with separate criteria per level.

Each tier has an `id` and its own `GatingFilter`. All tiers are evaluated **independently** against the same wallet.

## Defining tiers

```ts
import { Gating, GatingTraitValue } from "phygital-token-sdk";

const COLLECTION = "CollectionMint...";
const REWARD_TOKEN = "RewardTokenMint...";

const tiers = [
  Gating.tier("bronze", Gating.count(1, {
    collection: Gating.eq(COLLECTION),
  })),

  Gating.tier("silver", Gating.count(3, {
    collection: Gating.eq(COLLECTION),
  })),

  Gating.tier("gold", Gating.and(
    Gating.count(1, {
      collection: Gating.eq(COLLECTION),
      traits: Gating.traitsAll(
        Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
        Gating.trait("Level", GatingTraitValue.gte(5)),
      ),
    }),
    Gating.totalBalance(REWARD_TOKEN, 1_000_000n),
  )),
] as const;
```

## Evaluating

```ts
import { evaluateAssetGating } from "phygital-token-sdk";

const result = await evaluateAssetGating({
  assetPublicKey, // base64url secp256r1 public key
  rpc,            // DAS-capable RPC (e.g. Helius)
  tiers,
});
```

### Result shape

```ts
type GatingEvaluationResult = {
  owner: Address;
  tiers: Array<{
    id: string;
    passed: boolean;
    filterResult: GatingFilterResult;
  }>;
  passedTierIds: string[];  // all matching tiers, in declaration order
  passed: boolean;          // true if any tier passed
};
```

The SDK does not pick a single "best" tier. Use `passedTierIds` or inspect `tiers` and apply your own priority logic.

### Choosing a tier in your app

**Option A — highest declared tier that passed** (common for bronze → gold ladders):

```ts
const TIER_ORDER = ["bronze", "silver", "gold"] as const;

const assignedTier = [...TIER_ORDER]
  .reverse()
  .find((id) => result.passedTierIds.includes(id));

switch (assignedTier) {
  case "gold":
    return unlockPremium();
  case "silver":
    return unlockStandard();
  case "bronze":
    return unlockBasic();
  default:
    return denyAccess();
}
```

**Option B — grant every tier the user qualifies for**:

```ts
for (const tierId of result.passedTierIds) {
  await grantPerks(tierId);
}
```

**Option C — check a specific tier**:

```ts
if (result.passedTierIds.includes("gold")) {
  return unlockPremium();
}
```

A wallet that passes bronze, silver, and gold:

```ts
result.passedTierIds // ["bronze", "silver", "gold"]
```

### Per-tier detail

```ts
const gold = result.tiers.find((t) => t.id === "gold");
if (gold?.passed) {
  // qualified for gold perks
}
```

## Sync evaluation (no RPC)

When you already have DAS assets (tests, caching layer):

```ts
import { evaluateGatingTiers } from "phygital-token-sdk";

const result = evaluateGatingTiers(dasAssets, tiers);
```

## Alternative qualification paths per tier

Each tier's filter can use `Gating.or` internally:

```ts
Gating.tier("vip", Gating.or(
  Gating.count(1, { mint: Gating.eq("VIPPassMint...") }),
  Gating.and(
    Gating.count(5, { collection: Gating.eq(COLLECTION) }),
    Gating.totalBalance(REWARD_TOKEN, 10_000_000n),
  ),
))
```

## Single-tier apps

A single-tier app is just one entry in the array:

```ts
await evaluateAssetGating({
  assetPublicKey,
  rpc,
  tiers: [
    Gating.tier("default", Gating.count(1, {
      collection: Gating.eq(COLLECTION),
    })),
  ],
});
```
