# Overview

## What gating does

1. **Resolve owner** — looks up the on-chain owner of the phygital asset from its secp256r1 public key.
2. **Load wallet** — paginates through DAS `searchAssets` for that owner (NFTs, compressed NFTs, fungible tokens).
3. **Evaluate rules** — runs your filter tree(s) against the loaded assets.

Gating answers: *"Given what this person holds in their wallet, do they qualify?"*

## Four dimensions

Every rule filters on up to four fields. When combined in a single predicate, **all set fields must match on the same asset row**:

| Dimension | Source (DAS) | Example |
|-----------|--------------|---------|
| `collection` | `grouping` where key is `collection` | Hold any NFT from a collection mint |
| `mint` | asset `id` | Hold a specific NFT or token mint |
| `traits` | `content.metadata.attributes` | Rarity = Gold, Level ≥ 5 |
| `balance` | `token_info.balance` on that row | Token account balance in raw units |

Wallet-level aggregations (`count`, `totalBalance`) sit on top of these per-asset predicates.

## Mental model

```
┌─────────────────────────────────────────────────────────┐
│  evaluateAssetGating({ assetPublicKey, rpc, tiers })    │
└───────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────▼───────────────┐
            │  Owner wallet (DAS assets)     │
            └───────────────┬───────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
    Tier "bronze"      Tier "silver"      Tier "gold"
    (filter tree)      (filter tree)      (filter tree)
         │                  │                  │
         └──────────────────┴──────────────────┘
                            │
              passedTierIds
```

Each **tier** has its own `GatingFilter` tree. Tiers are evaluated **independently** — a user can pass multiple tiers at once.

## Filter tree layers

| Layer | API | SQL analogue |
|-------|-----|--------------|
| Per-asset predicate | `{ collection, mint, traits, balance }` | `WHERE` on one row |
| Count | `Gating.count(min, predicate, max?)` | `COUNT … HAVING` |
| Sum balance | `Gating.totalBalance(mint, min?, max?)` | `SUM(balance)` |
| Boolean | `Gating.and` / `or` / `not` | `AND` / `OR` / `NOT` |

Use `Gating.count(1, predicate)` for existence checks ("hold at least one asset matching …").

## Cardinality cheat sheet

| Intent | API |
|--------|-----|
| At least 1 matching asset | `Gating.count(1, { ... })` |
| At least N matching assets | `Gating.count(N, { ... })` |
| Exactly 1 matching asset | `Gating.count(1, { ... }, 1)` |
| Between N and M matching assets | `Gating.count(N, { ... }, M)` |
| Wallet-wide token total | `Gating.totalBalance(mint, min?, max?)` |

## Same asset vs same wallet

This is the most common source of bugs:

| Intent | Correct pattern |
|--------|-----------------|
| One NFT has Gold **and** Level ≥ 5 | Single predicate with `traits: Gating.traitsAll(...)` |
| Wallet holds mint A **and** mint B (any two assets) | `Gating.and(Gating.count(1, { mint: A }), Gating.count(1, { mint: B }))` |
| Wallet holds 3+ from collection | `Gating.count(3, { collection: ... })` |

See [Recipes](./recipes.md) for more patterns.

## Next steps

- [Predicates](./predicates.md) — operators on collection, mint, traits, balance
- [Filters & composition](./filters-and-composition.md) — building filter trees
- [Tiers](./tiers.md) — assigning users to bronze / silver / gold
