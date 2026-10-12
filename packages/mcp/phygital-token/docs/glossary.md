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
  ├── owner        ← wallet pubkey set at initialize (or updated by set_owner)
  ├── wallet_bump          ← wallet PDA bump, stored at initialize
  └── mint                 ← SPL mint pubkey (default until `assign_mint`)

Wallet PDA (seeds=["wallet", phygital_token])  ← never created; system-owned, holds SOL / token accounts
AccessoryPolicy (seeds=["policy", phygital_token])  ← created by the owner's first `update_policy`
  ├── payer                ← funded the account; receives all its rent on close
  ├── phygital_token       ← the token it belongs to (checked instead of re-deriving the PDA)
  ├── wallet               ← the token's wallet PDA (checked instead of re-deriving it)
  ├── sol_cap              ← SOL spend cap (none = no SOL may leave, wrapped SOL included)
  ├── mint_caps            ← per-mint spend caps (no cap = that mint can't be spent)
  ├── allowed_origins      ← sites taps may come from (empty = any); browser-only, a CTAP2-direct client can claim any origin
  └── program_permissions  ← programs (and optionally instructions) the accessory may call
  (executes read these bytes in place; only `update_policy` deserializes the account)
```

## Terms

| Term | On-chain / IDL name | Description |
|------|---------------------|-------------|
| **AdminConfig** | `admin_config` account (`AdminConfig`) | Singleton PDA. One admin, one issuer, one minter — roles must be distinct pubkeys. |
| **Phygital token** | `phygital_token` account (`PhygitalToken`) | Per-physical-item record. PDA seeded by passkey `public_key`. |
| **Passkey pubkey** | `phygital_token.public_key` | Compressed secp256r1 key. Seeds the PDA and authorizes transfers. Also used as WebAuthn `credential.id` / `user.id`. |
| **Identifier** | `phygital_token.identifier` | Chip-unique 33-byte binding value stored on the phygital token. Distinct from the passkey; not the PDA seed. |
| **Owner** | `phygital_token.owner` | Wallet currently associated with the token. Set at `initialize`. Updated by `set_owner` / cleared by `remove_owner` for Bearer and Controlled; immutable for Permanent. |
| **Lock** | `PhygitalToken::is_locked()` (derived, not stored) | Controlled and Permanent tokens are locked whenever they have an owner; Bearer tokens never are. While locked, `set_owner` fails with `TokenIsCurrentlyLocked`, so a Controlled owner must `remove_owner` first and a Permanent owner can never change. |
| **Wallet bump** | `phygital_token.wallet_bump` | Canonical bump of the wallet PDA, stored at `initialize`. |
| **Mint** | `phygital_token.mint` | Optional SPL mint binding. Starts as the default pubkey until `assign_mint`. |
| **Token type** | `phygital_token.token_type` | `Permanent` (discriminant 0 — owner required at initialize; stays locked; never transferable or forfeitable), `Bearer` (freely re-transferable when unlocked), or `Controlled` (auto-locks after claim; must forfeit via `remove_owner` before next set). |
| **Wallet** | `wallet` PDA, seeds `["wallet", phygital_token]` | The token's smart wallet. phygital-token signs for it in `execute_with_owner` / `execute_with_accessory`. Its assets stay with the token across owners (a Bearer re-link hands them to the new holder). |
| **Accessory policy** | `policy` PDA (`AccessoryPolicy`) | What an accessory tap may make the wallet do. Blocked by default: no policy = no accessory execution; within a policy, SOL, each mint and each program is blocked unless it has an entry. SOL includes rent and wrapped SOL in token accounts only the wallet can close. Caps meter SOL and token balances only: other authority the wallet holds (mint/freeze, stake, nonce, upgrade) is guarded only by program/instruction rules, and an allowed program can reuse the wallet's signature in its own CPIs. Rules match by program id, so an upgradeable program can change behaviour after it is allowed. `allowed_origins` is matched against the tap's `clientDataJSON.origin`: browsers write it, so it stops other websites using a tap, but a client talking CTAP2 to the accessory directly (e.g. a native NFC app) writes its own and can claim any origin. Empty = any site. Always belongs to the current owner: `set_owner` (to a new owner) and `remove_owner` close it, returning its rent to the accessory wallet; `close_phygital_token` closes it to `rent_recipient`. |
| **Policy action** | `PolicyAction` | One incremental `update_policy` change: `SetAllowedOrigins(Vec<String>)` (replaces the list; `https://host[:port]` or `http://localhost[:port]`, no trailing slash; empty = any), `SetSolCap(Option)`, `SetMintCap(mint, CapArg)`, `RemoveMintCap`, `SetProgramPermission` (add or replace by program id), `RemoveProgramPermission`. |
| **Compact instruction** | `CompactInstruction` | An inner instruction as indexes into the execute instruction's remaining accounts. The wallet PDA is passed unsigned; the program signs for it. |
| **Execute challenge** | `build_execute_challenge` | WebAuthn challenge for `execute_with_accessory`: `SHA256("execute" ‖ phygital_token ‖ slot_hash ‖ borsh(compact_instructions) ‖ accounts)`, where `accounts` is each referenced account's key followed by its effective privilege byte (`is_signer | is_writable << 1`). |
| **Expected rpId** | `verify.expected_rp_id` | Optional `Option<String>`. When set, `SHA256(rpId)` must match authenticatorData\[0..32\]. Omit / `None` skips. |
| **Expected origins** | `verify.expected_origins` | Optional `Option<Vec<String>>` allow-list. When set, signed `clientDataJSON.origin` must match one entry. Omit / `None` skips. |

## Instruction map

| Instruction | What it does |
|-------------|--------------|
| `create_config` | Creates the singleton **AdminConfig** PDA; signer becomes the sole admin. Callable once. |
| `set_admin` | Transfers the sole admin role (cannot promote issuer or minter). |
| `set_issuer` | Sets the single issuer pubkey (admin-only; must not collide with admin/minter). |
| `set_minter` | Sets the single minter pubkey (admin-only; must not collide with admin/issuer). |
| `close_phygital_token` | Admin closes a **phygital_token** PDA and sends its rent lamports to `rent_recipient`, closing its accessory policy too. Irreversible; the same passkey can be re-`initialize`d later (the wallet PDA's assets come back with it). |
| `initialize` | Creates a **phygital_token** PDA seeded by `secp256r1_pubkey`, stores `identifier`, `token_type`, and `owner`. Permanent requires a non-default `owner`. Stores the wallet bump. Restricted to **AdminConfig.issuer**. |
| `assign_mint` | Binds an SPL mint pubkey onto `phygital_token.mint`. Restricted to **AdminConfig.minter**. |
| `set_owner` | Passkey-authorized owner update to `recipient` (no SPL token). Requires the token to be unlocked (Bearer, or no owner). Permanent is always locked → always `TokenIsCurrentlyLocked`. Controlled is locked again once it has an owner. A new owner closes the previous owner's accessory policy. |
| `verify` | Passkey-authorized message proof; optional `expected_rp_id` / `expected_origins` (`Option`); updates `last_sign_count`. |
| `remove_owner` | Wallet-signed forfeiture — resets `phygital_token.owner` to default, which unlocks a Controlled token. Rejected for Permanent. Closes the accessory policy. |
| `update_policy` | Owner applies `PolicyAction`s to the accessory policy, creating it on first use (`payer` funds it). The account resizes to fit; growth is paid by that call's `payer`. Rent freed by removing entries stays in the account until it closes. |
| `close_policy` | Owner closes the accessory policy (rent to the accessory wallet); the accessory is blocked again. |
| `execute_with_owner` | Owner runs compact instructions as the wallet PDA with no policy. |
| `execute_with_accessory` | Accessory tap runs compact instructions as the wallet PDA. Requires an owner (so a Controlled or Permanent token is locked) and a policy. Every inner call must be allowed by `program_permissions`; every SOL / token spend must be covered by a cap and is charged to it (`SpendNotAllowed` otherwise). Advances `last_sign_count`. |
| `preview_execute` | Simulation only: `execute_with_accessory`'s checks without the tap. Takes the `origin` that will request the tap and checks it against `allowed_origins` (`None`, for native / CTAP2-direct clients, skips that check). Always fails, with `PreviewPassed` when a tap would be allowed. |

## Client naming

| Rust / IDL | TypeScript (hand-written) |
|------------|---------------------------|
| `create_config` | `getCreateConfigInstruction` / `findAdminConfigPda` |
| `set_issuer` / `set_minter` / `set_admin` | `getSetIssuerInstruction` / `getSetMinterInstruction` / `getSetAdminInstruction` |
| `close_phygital_token` | `getClosePhygitalTokenInstruction` / `getClosePhygitalTokenInstructionAsync` |
| `initialize` | `getInitializeInstruction` |
| `assign_mint` | `getAssignMintInstruction` |
| `set_owner` | `beginTransfer` / `authenticatePasskeyForTransfer` / `completeTransfer` |
| `verify` | `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify` / `buildSecp256r1VerifyInstruction` |
| `phygital_token` PDA | `findPhygitalTokenPda(secp256r1Pubkey)`, `fetchPhygitalTokenByIdentifier` |
| off-chain auth | `startAuthentication(message, { rpc })` + `verifyResponse({ expectedMessage, expectedOrigin, response })` → your session |

Test helpers mirror on-chain instruction names (`initialize`, `assign_mint`, `set_owner`, `verify`, etc.).
