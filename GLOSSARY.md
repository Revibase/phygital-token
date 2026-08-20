# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
PhygitalToken (token PDA)  ← created by `initialize`
  ├── public_key           ← secp256r1 passkey; PDA seed + transfer authority
  ├── identifier           ← chip binding field (distinct from passkey)
  ├── owner                ← wallet pubkey after claim (default until first transfer)
  └── mint                 ← SPL mint pubkey (default until `set_mint`)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Token** | `token` account (`PhygitalToken`) | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `token.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Also used as WebAuthn `credential.id` / `user.id`. |
| **Identifier** | `token.identifier` | Chip-unique 33-byte binding value stored on the token. Distinct from the passkey; not the PDA seed. |
| **Owner** | `token.owner` | Current custodian after a successful `transfer_ownership`. Starts as the default (zero) pubkey. |
| **Mint** | `token.mint` | Optional SPL mint binding. Starts as the default pubkey until `set_mint`. |
| **Token type** | `token.token_type` | `Controlled` (owner can lock transfers) or `Bearer` (cannot lock). |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `initialize` | Creates a **token** PDA seeded by `secp256r1_pubkey`, stores `identifier` + token type. Restricted to `ADMIN`. |
| `set_mint` | Admin binds an SPL mint pubkey onto `token.mint`. Restricted to `ADMIN`. |
| `transfer_ownership` | Passkey-authorized ownership update to `recipient` (no SPL token). |
| `verify` | Passkey-authorized message proof; updates `last_sign_count`. |
| `remove_ownership` | Wallet-signed forfeiture — resets `token.owner` to default. |
| `set_lock_state` | Owner toggles transfer lock on a `Controlled` token. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `initialize` | `buildInitializeInstruction` / `buildSquadsInitializeInstructions` |
| `set_mint` | `buildSetMintInstruction` / `buildSquadsSetMintInstructions` |
| `transfer_ownership` | `beginTransfer` / `completeTransfer` |
| `verify` | `beginVerify` / `completeVerify` |
| `token` PDA | `findTokenPda(secp256r1Pubkey)`, `fetchTokenByIdentifier` |
| off-chain auth | `startAuthentication` + `verifyResponse` |

Test helpers mirror on-chain instruction names (`initialize`, `transfer_ownership`, `verify`, etc.).
