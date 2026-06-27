# Recipes

Copy-paste patterns for common gating scenarios.

## Hold any NFT from a collection

```ts
Gating.count(1, { collection: Gating.eq("CollectionMint...") })
```

## Hold a specific NFT mint

```ts
Gating.count(1, { mint: Gating.eq("NftMint...") })
```

## Hold N NFTs from a collection

```ts
Gating.count(5, { collection: Gating.eq("CollectionMint...") })
```

## Gold NFT from collection (traits on same asset)

```ts
Gating.count(1, {
  collection: Gating.eq("CollectionMint..."),
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
  ),
})
```

## Gold OR Platinum from collection

```ts
Gating.count(1, {
  collection: Gating.eq("CollectionMint..."),
  traits: Gating.traitsAny(
    Gating.trait("Rarity", GatingTraitValue.in("Gold", "Platinum")),
  ),
})
```

## Minimum token balance (wallet-wide)

```ts
Gating.totalBalance("TokenMint...", 1_000_000n)
```

## Hold NFT A and NFT B (different assets OK)

```ts
Gating.and(
  Gating.count(1, { mint: Gating.eq("MintA...") }),
  Gating.count(1, { mint: Gating.eq("MintB...") }),
)
```

## VIP pass OR (collection holder + token balance)

```ts
Gating.or(
  Gating.count(1, { mint: Gating.eq("VIPPassMint...") }),
  Gating.and(
    Gating.count(1, { collection: Gating.eq("CollectionMint...") }),
    Gating.totalBalance("TokenMint...", 5_000_000n),
  ),
)
```

## Exclude banned collection

```ts
Gating.not(Gating.count(1, { collection: Gating.eq("BannedCol...") }))
```

## Exclude specific mints

```ts
Gating.count(1, { mint: Gating.notIn("Blocked1...", "Blocked2...") })
```

## Bronze / silver / gold tiers

```ts
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
        Gating.trait("Level", GatingTraitValue.gte(10)),
      ),
    }),
    Gating.totalBalance(REWARD_TOKEN, 10_000_000n),
  )),
];
```

## Full app integration

```ts
import {
  evaluateAssetGating,
  Gating,
  GatingTraitValue,
  summarizeGatingEvaluationFailure,
} from "phygital-token-sdk";

async function gateExperience(assetPublicKey: string, rpc: Rpc) {
  const result = await evaluateAssetGating({
    assetPublicKey,
    rpc,
    tiers: [
      Gating.tier("bronze", Gating.count(1, {
        collection: Gating.eq(process.env.COLLECTION_MINT!),
      })),
      Gating.tier("gold", Gating.count(1, {
        collection: Gating.eq(process.env.COLLECTION_MINT!),
        traits: Gating.traitsAll(
          Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
        ),
      })),
    ],
  });

  if (!result.passed) {
    return {
      allowed: false,
      reasons: summarizeGatingEvaluationFailure(result),
    };
  }

  return {
    allowed: true,
    passedTierIds: result.passedTierIds,
    owner: result.owner,
  };
}
```

## Footguns

### ❌ Traits split across NFTs

```ts
// WRONG — requires one NFT to be both Gold and Silver
Gating.count(1, {
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
    Gating.trait("Rarity", GatingTraitValue.eq("Silver")),
  ),
})
```

### ❌ Using two count(1) for traits on one NFT

```ts
// WRONG — checks two different assets
Gating.and(
  Gating.count(1, { traits: Gating.traitsAll(Gating.trait("Rarity", GatingTraitValue.eq("Gold"))) }),
  Gating.count(1, { traits: Gating.traitsAll(Gating.trait("Level", GatingTraitValue.gte(5))) }),
)

// RIGHT — one NFT, all traits
Gating.count(1, {
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
    Gating.trait("Level", GatingTraitValue.gte(5)),
  ),
})
```

### ❌ Contradictory AND

```ts
// Always fails
Gating.and(
  Gating.count(1, { collection: Gating.eq("ColA") }),
  Gating.not(Gating.count(1, { collection: Gating.eq("ColA") })),
)
```

### ❌ UI decimals in balance

```ts
// WRONG for 6-decimal token — this is 0.000001 tokens
Gating.totalBalance("USDC...", 1n)

// RIGHT — 1 USDC
Gating.totalBalance("USDC...", 1_000_000n)
```
