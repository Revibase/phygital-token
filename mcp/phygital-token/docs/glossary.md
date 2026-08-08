# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
Asset (asset PDA)     ← created by `initialize`
  ├── public_key      ← secp256r1 passkey; PDA seed + transfer authority
  ├── identifier      ← chip binding field (distinct from passkey)
  └── owner           ← wallet pubkey after claim (default until first transfer)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Asset** | `asset` account | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `asset.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Also used as WebAuthn `credential.id` / `user.id`. |
| **Identifier** | `asset.identifier` | Chip-unique 33-byte binding value stored on the asset. Distinct from the passkey; not the PDA seed. |
| **Owner** | `asset.owner` | Current custodian after a successful `execute_transfer`. Starts as the default (zero) pubkey. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `initialize` | Creates an **asset** PDA seeded by `secp256r1_pubkey`, stores `identifier` + asset type. |
| `execute_transfer` | Passkey-authorized ownership update to `recipient` (no SPL token). |
| `verify_asset` | Passkey-authorized message proof; updates `last_transfer_slot`. |
| `remove_ownership` | Wallet-signed forfeiture — resets `asset.owner` to default. |
| `set_lock_state` | Owner toggles transfer lock on a lockable asset. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `initialize` | `buildInitializeInstruction` |
| `execute_transfer` | `beginTransfer` / `completeTransfer` |
| `verify_asset` | `beginVerifyAsset` / `completeVerifyAsset` |
| `asset` PDA | `findAssetPda(secp256r1Pubkey)`, `fetchAssetByIdentifier` |
| off-chain auth | `startAuthentication` + `verifyResponse` |

Test helpers mirror on-chain instruction names (`initialize`, `execute_transfer`, etc.).
