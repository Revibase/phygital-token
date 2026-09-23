# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
PhygitalToken (phygital_token PDA)  ← created by `initialize`
  ├── public_key           ← secp256r1 passkey; PDA seed + transfer authority
  ├── identifier           ← chip binding field (distinct from passkey)
  ├── linked_wallet        ← wallet pubkey set at initialize (or updated by set_linked_wallet)
  └── mint                 ← SPL mint pubkey (default until `set_mint`)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **Phygital token** | `phygital_token` account (`PhygitalToken`) | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `phygital_token.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Also used as WebAuthn `credential.id` / `user.id`. |
| **Identifier** | `phygital_token.identifier` | Chip-unique 33-byte binding value stored on the phygital token. Distinct from the passkey; not the PDA seed. |
| **Linked wallet** | `phygital_token.linked_wallet` | Wallet currently associated with the token. Set at `initialize`. Updated by `set_linked_wallet` / cleared by `remove_linked_wallet` for Bearer and Controlled; immutable for Permanent. Not the authority when the linked wallet is a PhygitalWallet. |
| **Mint** | `phygital_token.mint` | Optional SPL mint binding. Starts as the default pubkey until `set_mint`. |
| **Token type** | `phygital_token.token_type` | `Permanent` (discriminant 0 — linked wallet required at initialize; never transferable or forfeitable), `Bearer` (freely re-transferable), or `Controlled` (auto-locks after claim; must forfeit via `remove_linked_wallet` before next set). |
| **Expected rpId** | `verify.expected_rp_id` | Optional `Option<String>`. When set, `SHA256(rpId)` must match authenticatorData\[0..32\]. Omit / `None` skips. |
| **Expected origins** | `verify.expected_origins` | Optional `Option<Vec<String>>` allow-list. When set, signed `clientDataJSON.origin` must match one entry. Omit / `None` skips. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `initialize` | Creates a **phygital_token** PDA seeded by `secp256r1_pubkey`, stores `identifier`, `token_type`, and `linked_wallet`. Permanent requires a non-default `linked_wallet`. Restricted to `ADMIN`. |
| `set_mint` | Admin binds an SPL mint pubkey onto `phygital_token.mint`. Restricted to `ADMIN`. |
| `set_linked_wallet` | Passkey-authorized linked-wallet update to `recipient` (no SPL token). Rejected for Permanent. Controlled tokens must be unlocked and re-lock after claim. |
| `verify` | Passkey-authorized message proof; optional `expected_rp_id` / `expected_origins` (`Option`); updates `last_sign_count`. |
| `remove_linked_wallet` | Wallet-signed forfeiture — resets `phygital_token.linked_wallet` to default and clears `is_locked`. Rejected for Permanent. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `initialize` | `getInitializeInstruction` |
| `set_mint` | `getSetMintInstruction` |
| `set_linked_wallet` | `beginTransfer` / `completeTransfer` |
| `verify` | `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify` / `buildSecp256r1VerifyInstruction` |
| `phygital_token` PDA | `findPhygitalTokenPda(secp256r1Pubkey)`, `fetchPhygitalTokenByIdentifier` |
| off-chain auth | `startAuthentication` + `verifyResponse` |

Test helpers mirror on-chain instruction names (`initialize`, `set_linked_wallet`, `verify`, etc.).
