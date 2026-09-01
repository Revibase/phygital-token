# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
PhygitalToken (phygital_token PDA)  ← created by `initialize`
  ├── public_key           ← secp256r1 passkey; PDA seed + transfer authority
  ├── identifier           ← chip binding field (distinct from passkey)
  ├── owner                ← wallet pubkey after claim (default until first transfer)
  └── mint                 ← SPL mint pubkey (default until `set_mint`)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Phygital token** | `phygital_token` account (`PhygitalToken`) | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `phygital_token.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Exposed as WebAuthn `response.id` after tap (recovered from the signature when a browser echoes a placeholder credential id). |
| **Identifier** | `phygital_token.identifier` | Chip-unique 33-byte binding value stored on the phygital token. Distinct from the passkey; not the PDA seed. |
| **Owner** | `phygital_token.owner` | Current custodian after a successful `transfer_ownership`. Starts as the default (zero) pubkey. |
| **Mint** | `phygital_token.mint` | Optional SPL mint binding. Starts as the default pubkey until `set_mint`. |
| **Token type** | `phygital_token.token_type` | `Controlled` (owner can lock transfers) or `Bearer` (cannot lock). |
| **Expected rpId** | `verify.expected_rp_id` | Optional `Option<String>`. When set, `SHA256(rpId)` must match authenticatorData\[0..32\]. Omit / `None` skips. |
| **Expected origins** | `verify.expected_origins` | Optional `Option<Vec<String>>` allow-list. When set, signed `clientDataJSON.origin` must match one entry. Omit / `None` skips. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `initialize` | Creates a **phygital_token** PDA seeded by `secp256r1_pubkey`, stores `identifier` + token type. Restricted to `ADMIN`. |
| `set_mint` | Admin binds an SPL mint pubkey onto `phygital_token.mint`. Restricted to `ADMIN`. |
| `transfer_ownership` | Passkey-authorized ownership update to `recipient` (no SPL token). |
| `verify` | Passkey-authorized message proof; optional `expected_rp_id` / `expected_origins` (`Option`); updates `last_sign_count`. |
| `remove_ownership` | Wallet-signed forfeiture — resets `phygital_token.owner` to default. |
| `set_lock_state` | Owner toggles transfer lock on a `Controlled` token. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `initialize` | `getInitializeInstruction` |
| `set_mint` | `getSetMintInstruction` |
| `transfer_ownership` | `beginTransfer` / `completeTransfer` |
| `verify` | `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify` / `buildSecp256r1VerifyInstruction` |
| `phygital_token` PDA | `findPhygitalTokenPda(secp256r1Pubkey)`, `fetchPhygitalTokenByIdentifier` |
| off-chain auth | `startAuthentication` + `verifyResponse` |

Test helpers mirror on-chain instruction names (`initialize`, `transfer_ownership`, `verify`, etc.).
