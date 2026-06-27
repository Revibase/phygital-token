# Predicates

A **predicate** (`GatingAssetPredicate`) describes one owned asset row. Every field you set must match on the **same** asset.

```ts
type GatingAssetPredicate = {
  collection?: GatingStringOp;
  mint?: GatingStringOp;
  traits?: GatingTraits;
  balance?: GatingBalance;
};
```

Predicates are passed to `Gating.count` (and nowhere else at the leaf level). Use the `Gating` and `GatingTraitValue` builders — do not construct raw op objects unless you are serializing rules.

## Collection & mint

String operators via `Gating.eq`, `Gating.neq`, `Gating.in`, `Gating.notIn`:

```ts
// Exact collection
{ collection: Gating.eq("CollectionMintABC...") }

// Any of several collections
{ collection: Gating.in("ColA...", "ColB...") }

// Exclude a collection
{ collection: Gating.notIn("BannedCol...") }

// Specific NFT mint
{ mint: Gating.eq("NftMint...") }

// One of several mints
{ mint: Gating.in("MintA...", "MintB...") }
```

Collection is read from DAS `grouping` entries where the key is `"collection"`.

## Traits (attributes)

Traits use `Gating.trait(trait_type, op)` with operators from `GatingTraitValue`:

| Operator | Builder | Example |
|----------|---------|---------|
| equals | `GatingTraitValue.eq(v)` | Rarity = Gold |
| not equals | `GatingTraitValue.neq(v)` | Rarity ≠ Common |
| in list | `GatingTraitValue.in(...)` | Rarity in (Gold, Platinum) |
| not in list | `GatingTraitValue.notIn(...)` | Rarity not in (Banned) |
| ≥ | `GatingTraitValue.gte(n)` | Level ≥ 5 |
| ≤ | `GatingTraitValue.lte(n)` | Level ≤ 10 |
| range | `GatingTraitValue.between(min, max)` | Level between 4 and 6 |

Combine traits with **all** or **any** on the same NFT:

```ts
// Gold AND Level >= 5 on the SAME NFT
traits: Gating.traitsAll(
  Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
  Gating.trait("Level", GatingTraitValue.gte(5)),
)

// Gold OR Platinum on the SAME NFT
traits: Gating.traitsAny(
  Gating.trait("Rarity", GatingTraitValue.in("Gold", "Platinum")),
)
```

### Trait matching notes

- Trait names and string values are compared **case-insensitively** (trimmed).
- Numeric comparisons (`gte`, `lte`, `between`) parse string attribute values when possible (`"5"` → `5`).
- `neq` / `notIn` pass when the trait type is **absent** on the asset.

## Balance

`Gating.balance(min?, max?)` filters the **raw** `token_info.balance` on that asset row (not UI decimals):

```ts
// This token row has between 1M and 2M raw units
{
  mint: Gating.eq("TokenMint..."),
  balance: Gating.balance(1_000_000n, 2_000_000n),
}

// Minimum only
{ balance: Gating.balance(1000n) }

// Maximum only
{ balance: Gating.balance(undefined, 5000n) }
```

For **wallet-wide** token totals (summing across accounts), use `Gating.totalBalance` instead — see [Filters & composition](./filters-and-composition.md).

NFT rows typically have no `token_info.balance`; balance checks on NFT-only predicates will fail unless the row is a fungible token.

## Full predicate example

```ts
Gating.count(1, {
  collection: Gating.eq("CollectionMint..."),
  mint: Gating.in("NftMint1...", "NftMint2..."),
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.in("Gold", "Platinum")),
    Gating.trait("Level", GatingTraitValue.between(5, 10)),
  ),
  balance: Gating.balance(0n), // optional; rarely needed on NFTs
})
```

## Debugging predicates

```ts
import { formatGatingPredicate } from "phygital-token-sdk";

console.log(formatGatingPredicate({
  collection: Gating.eq("Col..."),
  traits: Gating.traitsAll(
    Gating.trait("Rarity", GatingTraitValue.eq("Gold")),
  ),
}));
// → "collection = Col..., traits all [Rarity = Gold]"
```
