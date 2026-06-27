# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Mint tokenized assets bound to passkeys, verify ownership via WebAuthn, transfer credentials, and gate experiences based on what the asset owner holds on-chain.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

Requires a Solana RPC. Gating and rich asset metadata need a DAS-capable provider (e.g. [Helius](https://helius.dev)).

## Quick start

```ts
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  evaluateAssetGating,
  Gating,
  GatingTraitValue,
  verifyWithChallengeResponse,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://mainnet.helius-rpc.com/?api-key=...");
```

### Verify a phygital asset

```ts
const verified = await verifyWithChallengeResponse({
  rpc,
  assetPublicKey, // base64url secp256r1 public key
  // ... WebAuthn options
});
```

### Gate access by wallet holdings

```ts
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

## Features

| Area | Exports |
|------|---------|
| **Mint** | `buildCreateMintInstructions`, `buildMintTokenInstructions`, `parseSecp256r1Pubkey` |
| **Verify** | `verifyWithChallengeResponse`, `verifyDynamicUrl`, `verifyWithChallengeResponseOverNfc` |
| **Transfer** | `beginTransfer`, `completeTransfer`, `authenticatePasskey` |
| **Metadata** | `fetchAssetDisplayInfo`, `resolveMedia` |
| **Gating** | `evaluateAssetGating`, `Gating`, `GatingTraitValue` |
| **Generated** | Program instructions, accounts, types (Codama) |

## Gating documentation

Wallet-based gating lets you segment users by collection, mint, NFT traits, and token balances. Full guides:

- **[Gating overview](./docs/gating/README.md)** — start here
- [Overview & mental model](./docs/gating/overview.md)
- [Predicates](./docs/gating/predicates.md) — `collection`, `mint`, `traits`, `balance`
- [Filters & composition](./docs/gating/filters-and-composition.md) — `count`, `totalBalance`, `and` / `or` / `not`
- [Tiers](./docs/gating/tiers.md) — bronze / silver / gold patterns
- [Evaluation & errors](./docs/gating/evaluation-and-errors.md) — debugging and failure messages
- [Recipes](./docs/gating/recipes.md) — copy-paste examples

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## License

ISC
