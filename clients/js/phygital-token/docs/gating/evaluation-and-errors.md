# Evaluation & errors

## Entry points

| Function | When to use |
|----------|-------------|
| `evaluateAssetGating` | Production — resolves owner, fetches DAS assets, evaluates tiers |
| `evaluateGatingTiers` | You already have the owner's DAS asset list |
| `evaluateGatingFilter` | You already have assets and a single filter tree |
| `assetMatchesPredicate` | Test one asset row against a predicate |

## `evaluateAssetGating` flow

```
assetPublicKey → find asset PDA → read owner
owner → searchAssets (paginated) → DasAsset[]
DasAsset[] + tiers → evaluateGatingTiers → GatingEvaluationResult
```

## Filter result tree

Every evaluation returns a structured `filterResult` (per tier) you can inspect:

```ts
const gold = result.tiers.find((t) => t.id === "gold");
const tree = gold?.filterResult;

// tree.kind: "count" | "totalBalance" | "and" | "or" | "not"
// tree.passed: boolean

if (tree?.kind === "count") {
  console.log(tree.matchCount); // how many assets matched
}

if (tree?.kind === "totalBalance") {
  console.log(tree.total); // summed raw balance
}

if (tree?.kind === "and") {
  console.log(tree.children); // per-child results
}
```

Use this for admin dashboards, debug panels, or analytics.

## Failure messages

Human-readable summaries when gating fails:

```ts
import {
  summarizeGatingEvaluationFailure,
  summarizeGatingTierFailure,
  summarizeGatingFailure,
} from "phygital-token-sdk";

// No tier passed — all tier failures
const reasons = summarizeGatingEvaluationFailure(result);
// [
//   'Tier "bronze":',
//   '  Need at least 5 asset(s) matching collection = ...; found 2.',
//   'Tier "gold":',
//   '  Need at least 9000000 raw balance for mint ...; found 1500000.',
// ]

// One tier
const gold = result.tiers.find((t) => t.id === "gold");
summarizeGatingTierFailure(gold!);

// Single filter tree (no tiers)
summarizeGatingFailure(filterResult);
```

`summarizeGatingEvaluationFailure` returns `[]` when **any** tier passed. To explain why a specific tier failed even when another passed, use `summarizeGatingTierFailure` on that tier.

### Predicate formatting

```ts
import { formatGatingPredicate } from "phygital-token-sdk";

formatGatingPredicate({
  collection: Gating.in("ColA", "ColB"),
  traits: Gating.traitsAll(
    Gating.trait("Level", GatingTraitValue.gte(5)),
  ),
});
// "collection in (ColA, ColB), traits all [Level >= 5]"
```

## UX patterns

### Show why access was denied

```ts
if (!result.passed) {
  const message = summarizeGatingEvaluationFailure(result).join("\n");
  showError(message);
}
```

### Show progress toward next tier

```ts
const silver = result.tiers.find((t) => t.id === "silver");
if (silver?.filterResult.kind === "count") {
  const need = 3;
  const have = silver.filterResult.matchCount;
  showProgress(`Collection NFTs: ${have} / ${need}`);
}
```

## Common failure modes

| Symptom | Likely cause |
|---------|--------------|
| Always fails on traits | Traits split across NFTs — use one predicate with `traitsAll` |
| `count(1, …)` fails but user "has the NFT" | Predicate includes extra fields (`collection` + wrong `mint`) |
| Balance gate fails | Using UI amount instead of raw units (multiply by `10^decimals`) |
| Collection not detected | DAS grouping missing or non-standard collection key |
| Empty wallet | Owner has no indexed DAS assets yet |

## Raw vs UI token amounts

`balance` and `totalBalance` use **raw** on-chain units. For a 6-decimal token:

| UI amount | Raw units |
|-----------|-----------|
| 1 token | `1_000_000n` |
| 1.5 tokens | `1_500_000n` |

```ts
const RAW = 10n ** 6n;
Gating.totalBalance(USDC_MINT, 100n * RAW); // 100 USDC
```
