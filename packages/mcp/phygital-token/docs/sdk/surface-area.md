# SDK surface area

TypeScript package: `phygital-token-sdk` (`packages/js/phygital-token`).

## WebAuthn credential id

| `rawId` length | Behavior |
|----------------|----------|
| 33 bytes | Authenticator returned the secp256r1 public key — used as `response.id` |
| 16 bytes | Platform echoed random placeholder — recover from signature |

When recovery is ambiguous, the SDK selects the candidate with an initialized PhygitalToken PDA on-chain (`rpc`), or the one in your `allowList` when no `rpc` is given.

## Shared tap helper

All three on-chain tap entry points (`authenticatePasskey`, `authenticatePasskeyForTransfer`, `authenticatePasskeyForSecp256r1Verify`) share:

| Option | Behavior |
|--------|----------|
| `{ rpc }` | Browser WebAuthn; recovers a placeholder id via on-chain PhygitalToken lookup. |
| `{ allowList }` | Set of base64url compressed public keys. Always gates: the tapped credential id must be in it, else `PASSKEY_NOT_RECOGNIZED`. Fallback for recovering a placeholder id locally when no `rpc` is given. |
| `{ transceive }` | Native/kiosk APDU via `authenticateWithApdu` |

Off-chain login uses `startAuthentication(message, { rpc, allowList? })` + `verifyResponse({ expectedMessage, response })`.

## Admin / roles

| Export | Purpose |
|--------|---------|
| `getCreateConfigInstruction` | Create singleton AdminConfig PDA; signer becomes sole admin |
| `getSetAdminInstruction` | Transfer admin (cannot promote issuer/minter) |
| `getSetIssuerInstruction` | Set the single issuer pubkey |
| `getSetMinterInstruction` | Set the single minter pubkey |
| `getClosePhygitalTokenInstruction` / `getClosePhygitalTokenInstructionAsync` | Admin closes a phygital token PDA and sends rent to `rentRecipient` |
| `findAdminConfigPda` | Derive AdminConfig PDA (`["admin"]`) |

Roles must be distinct pubkeys. `initialize` requires issuer; `assign_mint` requires minter; `close_phygital_token` requires admin.

## Initialize

| Export | Purpose |
|--------|---------|
| `getInitializeInstruction` | Create token PDA (seeded by passkey; requires `linkedWallet` + `AdminConfig`) |
| `parseSecp256r1Pubkey` | Parse a base64url 33-byte compressed secp256r1 public key |
| `findPhygitalTokenPda` | Derive the phygital token PDA from a passkey public key |
| `findAdminConfigPda` | Derive AdminConfig for the initialize accounts |

Authority must be `AdminConfig.issuer`. Bootstrap with `create_config` → `set_issuer`. Tokens with a non-default `linkedWallet` at init start locked (`is_locked = 1`).

## Assign mint

| Export | Purpose |
|--------|---------|
| `getAssignMintInstruction` | Bind an SPL mint pubkey onto `phygital_token.mint` |
| `findPhygitalTokenPda` | Derive the phygital token PDA from a passkey public key |
| `findAdminConfigPda` | Derive AdminConfig for the assign_mint accounts |

`assign_mint` authority must be `AdminConfig.minter`. The authority account is a signer but is **not** writable. Bootstrap with `create_config` → `set_minter`.

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer({ rpc, secp256r1Pubkey, rpId? })` | Derives token PDA from passkey; slot-bound challenge; `rpId` defaults to hostname |
| `authenticatePasskeyForTransfer(session, { transceive? })` | NFC tap; optional `transceive` for native APDU |
| `completeTransfer` | Kit `TransactionSigner` recipient; `response.id` as passkey; builds secp + set_linked_wallet |

`set_linked_wallet` requires `is_locked == 0` for **every** token type. Permanent tokens stay locked and always fail with `TokenIsCurrentlyLocked`. Controlled tokens re-lock after claim.

## Verify (on-chain composable)

| Export | Purpose |
|--------|---------|
| `buildMessageHash(message)` | SHA-256 `message` to a 32-byte `messageHash` |
| `authenticatePasskeyForSecp256r1Verify({ rpc, allowList?, messageHash, rpId?, transceive? })` | Uses `messageHash` as WebAuthn challenge; `rpc` recovers a placeholder id, `allowList` gates the tapped id (and is the no-RPC recovery fallback); optional `transceive` for native APDU |
| `buildSecp256r1VerifyInstruction` | After tap: `{ secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs }` |
| `getVerifyInstruction` | Generated `verify` ix — `expectedRpId` / `expectedOrigins` are `Option` (`null` skips). CPI callers set these on `VerifyCpiBuilder`, not the tap helper. |

See `verification:verify-composable` and `building-on-phygital:rust-cpi`. When `expectedOrigins` is set, `clientDataJSON.origin` must match one listed origin.

## Remove linked wallet

| Export | Purpose |
|--------|---------|
| `getRemoveLinkedWalletInstruction` | Wallet-signed forfeiture — reset `phygital_token.linked_wallet` to default and clear `is_locked` |

## Verification (off-chain only)

| Export | Purpose |
|--------|---------|
| `startAuthentication(message, { rpc, allowList? })` | NFC tap; `rpc` recovers a placeholder id, `allowList` gates the tapped id (and is the no-RPC fallback), or `{ transceive }` for APDU |
| `verifyResponse({ expectedMessage, response })` | secp256r1 check (no rpId/origin); returns `secp256r1PublicKey` |

Issue any short-lived message string — no `generateAuthenticationOptions`. Then create your normal session.

## Token lookup

| Export | Purpose |
|--------|---------|
| `findPhygitalTokenPda` | Derive token PDA from passkey public key (base64url string or parsed `Secp256r1Pubkey`) |
| `findAdminConfigPda` | Derive AdminConfig PDA |
| `fetchPhygitalTokenByIdentifier` | Kit `Rpc`; `getProgramAccounts` memcmp on chip `identifier` |
| `fetchPhygitalTokensByLinkedWallet` | Kit `Rpc` + `Address` linkedWallet |
| `fetchPhygitalTokenByMint` | Kit `Address` mint + Kit `Rpc` |
| `fetchPhygitalToken` | Generated helper — Kit `Rpc` + token PDA |
| `fetchAdminConfig` | Generated helper — Kit `Rpc` + AdminConfig PDA |

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getInitializeInstruction`, `getAssignMintInstruction`, `getSetLinkedWalletInstruction`, `getVerifyInstruction`, `getRemoveLinkedWalletInstruction`, `getCreateConfigInstruction`, `getSetAdminInstruction`, `getSetIssuerInstruction`, `getSetMinterInstruction`, `getClosePhygitalTokenInstruction`, …
- Accounts: `fetchPhygitalToken`, `fetchAdminConfig`, `findAdminConfigPda`, `PhygitalToken`, `AdminConfig`, …
- Types: `PhygitalTokenType` (`Permanent` | `Bearer` | `Controlled`), `Secp256r1Pubkey`, …

## Rust client

Crate: `phygital-token-client` at `packages/rust/phygital-token`.

On-chain: instruction builders, CPI helpers (`VerifyCpiBuilder`, `AssignMintCpiBuilder`, `SetLinkedWalletCpiBuilder`, `CreateConfigCpiBuilder`, …), account layouts, errors. `VerifyCpiBuilder.expected_rp_id` / `.expected_origins` are optional (`Option`); omit them to skip those checks.

`PhygitalTokenType`: `Permanent` (0, immutable linked wallet, stays locked), `Bearer` (1), `Controlled` (2, lock/forfeit).

Off-chain (`fetch` feature): RPC account fetching helpers.
