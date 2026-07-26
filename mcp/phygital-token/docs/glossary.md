# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
Collection (group_mint)
  └── Design mint (mint)          ← created by `create_mint`
        └── Asset (asset PDA)     ← created by `mint_token`, 1:1 with passkey
              └── SPL token unit  ← held in program_authority custody until claim
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Collection** | `group_mint` | Token-2022 TokenGroup parent mint. Groups related designs. |
| **Design** | `mint` (in `create_mint`) | Shared SFT template — one metadata set, many physical instances. |
| **Asset** | `asset` account | Per-physical-item record keyed by secp256r1 passkey pubkey. |
| **Passkey pubkey** | `asset.public_key` | Compressed secp256r1 key. The custom authenticator also uses it as WebAuthn `credential.id` and `user.id`, so `response.id` after a tap is this key — there is no separate on-chain credential id. |
| **Owner** | `asset.owner` | Current custodian after a successful `execute_transfer` claim. |
| **Custody** | `program_authority` | PDA that holds unclaimed tokens and acts as permanent delegate. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `create_mint` | Creates a **design** mint (member of a collection `group_mint`). |
| `mint_token` | Mints one SPL token into custody and initializes an **asset** PDA. |
| `execute_transfer` | Passkey-authorized claim/transfer from current owner to recipient. |
| `remove_ownership` | Wallet-signed forfeiture — returns token to custody and resets `asset.owner`. |
| `set_lock_state` | Owner toggles transfer lock on a configurable asset. |
| `create_domain_config` / `update_domain_config` | WebAuthn RP ID and origin allowlist. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `group_mint` | `groupMint` / `collectionMint` (display) |
| `create_mint` | `buildCreateMintInstructions` |
| `mint_token` | `buildMintTokenInstructions` |
| `asset` PDA | `findAssetPda`, `AssetDisplayInfo` |

Test helpers mirror on-chain instruction names (`create_mint`, `mint_token`, etc.).
