# Phygital Token — Domain Glossary

Shared vocabulary for on-chain accounts, instructions, tests, and the TypeScript client.

## Hierarchy

```
AdminConfig (singleton PDA, seeds=["admin"])
  ├── admin    ← sole admin (create_config signer; set_admin / set_issuer / set_minter / close_phygital_token)
  ├── issuer   ← sole issuer (may call initialize)
  └── minter   ← sole minter (may call assign_mint)

PhygitalToken (phygital_token PDA)  ← created by `initialize`
  ├── public_key           ← secp256r1 passkey; PDA seed + transfer authority
  ├── identifier           ← chip binding field (distinct from passkey)
  ├── linked_wallet        ← wallet pubkey set at initialize (or updated by set_linked_wallet)
  ├── is_locked            ← 1 when linked wallet set at init / after Controlled claim
  └── mint                 ← SPL mint pubkey (default until `assign_mint`)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **AdminConfig** | `admin_config` account (`AdminConfig`) | Singleton PDA. One admin, one issuer, one minter — roles must be distinct pubkeys. |
| **Phygital token** | `phygital_token` account (`PhygitalToken`) | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `phygital_token.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Also used as WebAuthn `credential.id` / `user.id`. |
| **Identifier** | `phygital_token.identifier` | Chip-unique 33-byte binding value stored on the phygital token. Distinct from the passkey; not the PDA seed. |
| **Linked wallet** | `phygital_token.linked_wallet` | Wallet currently associated with the token. Set at `initialize`. Updated by `set_linked_wallet` / cleared by `remove_linked_wallet` for Bearer and Controlled; immutable for Permanent. |
| **Lock** | `phygital_token.is_locked` | When `1`, `set_linked_wallet` fails with `TokenIsCurrentlyLocked`. Non-default linked wallet at init starts locked. Controlled re-locks after claim; `remove_linked_wallet` clears the lock. |
| **Mint** | `phygital_token.mint` | Optional SPL mint binding. Starts as the default pubkey until `assign_mint`. |
| **Token type** | `phygital_token.token_type` | `Permanent` (discriminant 0 — linked wallet required at initialize; stays locked; never transferable or forfeitable), `Bearer` (freely re-transferable when unlocked), or `Controlled` (auto-locks after claim; must forfeit via `remove_linked_wallet` before next set). |
| **Expected rpId** | `verify.expected_rp_id` | Optional `Option<String>`. When set, `SHA256(rpId)` must match authenticatorData\[0..32\]. Omit / `None` skips. |
| **Expected origins** | `verify.expected_origins` | Optional `Option<Vec<String>>` allow-list. When set, signed `clientDataJSON.origin` must match one entry. Omit / `None` skips. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `create_config` | Creates the singleton **AdminConfig** PDA; signer becomes the sole admin. Callable once. |
| `set_admin` | Transfers the sole admin role (cannot promote issuer or minter). |
| `set_issuer` | Sets the single issuer pubkey (admin-only; must not collide with admin/minter). |
| `set_minter` | Sets the single minter pubkey (admin-only; must not collide with admin/issuer). |
| `close_phygital_token` | Admin closes a **phygital_token** PDA and sends its rent lamports to `rent_recipient`. Irreversible; the same passkey can be re-`initialize`d later. |
| `initialize` | Creates a **phygital_token** PDA seeded by `secp256r1_pubkey`, stores `identifier`, `token_type`, and `linked_wallet`. Permanent requires a non-default `linked_wallet`. Non-default linked wallet starts locked. Restricted to **AdminConfig.issuer**. |
| `assign_mint` | Binds an SPL mint pubkey onto `phygital_token.mint`. Restricted to **AdminConfig.minter**. |
| `set_linked_wallet` | Passkey-authorized linked-wallet update to `recipient` (no SPL token). Requires `is_locked == 0`. Permanent stays locked → always `TokenIsCurrentlyLocked`. Controlled re-locks after claim. |
| `verify` | Passkey-authorized message proof; optional `expected_rp_id` / `expected_origins` (`Option`); updates `last_sign_count`. |
| `remove_linked_wallet` | Wallet-signed forfeiture — resets `phygital_token.linked_wallet` to default and clears `is_locked`. Rejected for Permanent. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `create_config` | `getCreateConfigInstruction` / `findAdminConfigPda` |
| `set_issuer` / `set_minter` / `set_admin` | `getSetIssuerInstruction` / `getSetMinterInstruction` / `getSetAdminInstruction` |
| `close_phygital_token` | `getClosePhygitalTokenInstruction` / `getClosePhygitalTokenInstructionAsync` |
| `initialize` | `getInitializeInstruction` |
| `assign_mint` | `getAssignMintInstruction` |
| `set_linked_wallet` | `beginTransfer` / `authenticatePasskeyForTransfer` / `completeTransfer` |
| `verify` | `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify` / `buildSecp256r1VerifyInstruction` |
| `phygital_token` PDA | `findPhygitalTokenPda(secp256r1Pubkey)`, `fetchPhygitalTokenByIdentifier` |
| off-chain auth | `startAuthentication(message, { rpc })` + `verifyResponse` → your session (or `startAuthentication(message, { transceive })` for native APDU — rpId/origin optional) |

Test helpers mirror on-chain instruction names (`initialize`, `assign_mint`, `set_linked_wallet`, `verify`, etc.).
