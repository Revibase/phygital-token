# Filters & composition

A `GatingFilter` is a composable tree evaluated against the owner's full wallet.

## Leaf nodes

### `Gating.count(min, predicate, max?)`

Counts owned assets matching the predicate. Passes when count is `≥ min` and (if set) `≤ max`.

```ts
// At least one NFT from collection (existence)
Gating.count(1, { collection: Gating.eq("CollectionMint...") })

// At least 3 from collection
Gating.count(3, { collection: Gating.eq("CollectionMint...") })

// Exactly 1 Gold NFT from collection
Gating.count(1, {
  collection: Gating.eq("CollectionMint..."),
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
  ),
}, 1)

// Between 2 and 5 matching assets
Gating.count(2, { collection: Gating.eq("CollectionMint...") }, 5)
```

`Gating.count(1, predicate)` is the standard existence check. There is no separate `match` API.

### `Gating.totalBalance(mint, min?, max?)`

Sums **raw** balance for `mint` across all owned asset rows (wallet-wide):

```ts
// At least 1 USDC (6 decimals → 1_000_000 raw units)
Gating.totalBalance("EPjFWdd5...", 1_000_000n)

// Between 1 and 10 USDC
Gating.totalBalance("EPjFWdd5...", 1_000_000n, 10_000_000n)
```

Use `totalBalance` for fungible gates. Use `balance` on a predicate when checking a single token account row together with `mint`.

## Compositors

### `Gating.and(...filters)`

Every child must pass.

```ts
Gating.and(
  Gating.count(2, { collection: Gating.eq("Col...") }),
  Gating.totalBalance("TokenMint...", 1_000_000n),
)
```

### `Gating.or(...filters)`

At least one child must pass.

```ts
Gating.or(
  Gating.count(1, { mint: Gating.eq("VIPPassMint...") }),
  Gating.and(
    Gating.count(3, { collection: Gating.eq("Col...") }),
    Gating.totalBalance("RewardToken...", 100n),
  ),
)
```

### `Gating.not(filter)`

Inverts a child. Passes when the inner filter **fails**.

```ts
// Must NOT hold from banned collection
Gating.not(Gating.count(1, { collection: Gating.eq("BannedCol...") }))
```

## Example campaign rule

Require 2+ collection NFTs, 1 Gold with level, and enough reward tokens:

```ts
const campaignFilter = Gating.and(
  Gating.count(2, { collection: Gating.eq("CollectionMint...") }),
  Gating.count(1, {
    collection: Gating.eq("CollectionMint..."),
    traits: Gating.traitsAll(
      Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
      Gating.trait("Level", GatingTraitValue.gte(5)),
    ),
  }),
  Gating.totalBalance("RewardTokenMint...", 1_000_000n),
);
```

Wrap this in `Gating.tier("vip", campaignFilter)` when using multi-tier evaluation — see [Tiers](./tiers.md).

## Evaluating without RPC

For unit tests or when you already have DAS assets:

```ts
import { evaluateGatingFilter } from "phygital-token-sdk";

const result = evaluateGatingFilter(dasAssets, campaignFilter);
console.log(result.passed);
console.log(result.kind); // "and" | "count" | ...

if (result.kind === "count") {
  console.log(result.matchCount);
}
```

## Conflicting rules

The evaluator does not detect impossible rules upfront. Unsatisfiable `and` trees return `passed: false`. See [Evaluation & errors](./evaluation-and-errors.md) for failure messages and common footguns.
