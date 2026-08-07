# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
Asset (asset PDA)     ← created by `initialize`
  ├── identifier      ← chip id; PDA seed (distinct from passkey)
  ├── public_key      ← secp256r1 passkey; authorizes transfers
  └── owner           ← wallet pubkey after claim (default until first transfer)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Asset** | `asset` account | Per-physical-item record. PDA seeded by chip `identifier`. |
| **Identifier** | `asset.identifier` | Chip-unique 33-byte value used as the asset PDA seed. Distinct from the passkey. |
| **Passkey pubkey** | `asset.public_key` | Compressed secp256r1 key. The custom authenticator also uses it as WebAuthn `credential.id` and `user.id`, so `response.id` after a tap is this key. |
| **Owner** | `asset.owner` | Current custodian after a successful `execute_transfer`. Starts as the default (zero) pubkey. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `initialize` | Creates an **asset** PDA seeded by `identifier`, stores passkey + asset type. |
| `execute_transfer` | Passkey-authorized ownership update to `recipient` (no SPL token). |
| `remove_ownership` | Wallet-signed forfeiture — resets `asset.owner` to default. |
| `set_lock_state` | Owner toggles transfer lock on a lockable asset. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `initialize` | `buildInitializeInstruction` |
| `execute_transfer` | `beginTransfer` / `completeTransfer` |
| `asset` PDA | `findAssetPda(identifier)` |
| off-chain auth | `startAuthentication` + `verifyResponse` |

Test helpers mirror on-chain instruction names (`initialize`, `execute_transfer`, etc.).
