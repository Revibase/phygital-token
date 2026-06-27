# Gating

[← phygital-token-sdk](../../README.md)

Gate access based on what a phygital asset's **owner** holds on-chain. The SDK loads the owner's wallet via Helius DAS `searchAssets`, then evaluates composable filter rules you define.

## Who this is for

Developers building experiences where tapping or verifying a phygital asset unlocks content, perks, or pricing tiers depending on the owner's NFT collection, specific mints, metadata traits, or token balances.

## Requirements

- A DAS-capable RPC (e.g. [Helius](https://helius.dev)) — the same `rpc` used for `fetchAsset` is reused for `searchAssets` via `rpc.execute`.
- The phygital asset's base64url-encoded secp256r1 public key.

## Quick example

```ts
import {
  evaluateAssetGating,
  Gating,
  GatingTraitValue,
} from "phygital-token-sdk";

const result = await evaluateAssetGating({
  assetPublicKey,
  rpc,
  tiers: [
    Gating.tier("bronze", Gating.count(1, {
      collection: Gating.eq("CollectionMint..."),
    })),
    Gating.tier("gold", Gating.count(1, {
      collection: Gating.eq("CollectionMint..."),
      traits: Gating.traitsAll(
        Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
      ),
    })),
  ],
});

if (result.passedTierIds.includes("gold")) {
  // unlock premium experience
}
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Overview](./overview.md) | Mental model, data flow, four filter dimensions |
| [Predicates](./predicates.md) | `collection`, `mint`, `traits`, `balance` operators |
| [Filters & composition](./filters-and-composition.md) | `count`, `totalBalance`, `and` / `or` / `not` |
| [Tiers](./tiers.md) | Multi-tier gating (bronze / silver / gold) |
| [Evaluation & errors](./evaluation-and-errors.md) | Results, debugging, failure messages |
| [Recipes](./recipes.md) | Common patterns and footguns |

## API exports

```ts
// Evaluation
evaluateAssetGating
evaluateGatingFilter
evaluateGatingTiers
assetMatchesPredicate

// Builders
Gating
GatingTraitValue

// Debugging
formatGatingPredicate
summarizeGatingFailure
summarizeGatingTierFailure
summarizeGatingEvaluationFailure

// Types
GatingFilter
GatingAssetPredicate
GatingTier
GatingEvaluationResult
GatingTiersEvaluationResult
// ...and more
```
