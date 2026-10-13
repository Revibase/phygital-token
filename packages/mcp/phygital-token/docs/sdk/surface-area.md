# SDK surface area

TypeScript package: `phygital-token-sdk` (`packages/js/phygital-token`).

## WebAuthn credential id

| `rawId` length | Behavior |
|----------------|----------|
| 33 bytes | Authenticator returned the secp256r1 public key — used as `response.id` |
| 16 bytes | Platform echoed random placeholder — recover from signature |

When recovery is ambiguous, the SDK selects the candidate with an initialized PhygitalToken PDA on-chain (`rpc`), or the one in your `allowList` when no `rpc` is given.

## Shared tap helper

The tap entry points (`authenticatePasskey`, `startAuthentication`, `authenticatePasskeyForTransfer`) share:

| Option | Behavior |
|--------|----------|
| `{ rpc }` | Browser WebAuthn; recovers a placeholder id via on-chain PhygitalToken lookup. |
| `{ allowList }` | Set of base64url compressed public keys. Always gates: the tapped credential id must be in it, else `PASSKEY_NOT_RECOGNIZED`. Fallback for recovering a placeholder id locally when no `rpc` is given. |

Off-chain login uses `startAuthentication(message, { rpc, allowList? })` + `verifyResponse({ expectedMessage, expectedOrigin, response })`.

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
| `getInitializeInstruction` | Create token PDA (seeded by passkey; requires `owner` + `AdminConfig`) |
| `parseSecp256r1Pubkey` | Parse a base64url 33-byte compressed secp256r1 public key |
| `findPhygitalTokenPda` | Derive the phygital token PDA from a passkey public key |
| `findAdminConfigPda` | Derive AdminConfig for the initialize accounts |

Authority must be `AdminConfig.issuer`. Bootstrap with `create_config` → `set_issuer`. Only Permanent tokens may set a non-default `owner` at init, and they are always locked.

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
| `authenticatePasskeyForTransfer(session)` | NFC tap |
| `completeTransfer` | Kit `TransactionSigner` recipient; `response.id` as passkey; builds secp + set_owner |

`set_owner` requires an unlocked token (`isPhygitalTokenLocked`): Controlled and Permanent tokens are locked whenever they have an owner, so Permanent always fails with `TokenIsCurrentlyLocked` and a claimed Controlled token must `remove_owner` first.

## Remove owner

| Export | Purpose |
|--------|---------|
| `getRemoveOwnerInstruction` | Wallet-signed forfeiture — reset `phygital_token.owner` to default |

## Verification (off-chain only)

| Export | Purpose |
|--------|---------|
| `startAuthentication(message, { rpc, allowList? })` | NFC tap; `rpc` recovers a placeholder id, `allowList` gates the tapped id (and is the no-RPC fallback) |
| `verifyResponse({ expectedMessage, expectedOrigin, response })` | asynchronous secp256r1 check; rejects taps from other origins (`ORIGIN_MISMATCH`); returns `{ isVerified, secp256r1PublicKey }` |

Issue any short-lived message string — no `generateAuthenticationOptions`. Then create your normal session.

## Token lookup

| Export | Purpose |
|--------|---------|
| `findPhygitalTokenPda` | Derive token PDA from passkey public key (base64url string or parsed `Secp256r1Pubkey`) |
| `findAdminConfigPda` | Derive AdminConfig PDA |
| `fetchPhygitalTokenByIdentifier` | Kit `Rpc`; `getProgramAccounts` memcmp on chip `identifier` |
| `fetchPhygitalTokensByOwner` | Kit `Rpc` + `Address` owner |
| `fetchPhygitalTokenByMint` | Kit `Address` mint + Kit `Rpc` |
| `fetchPhygitalToken` | Generated helper — Kit `Rpc` + token PDA |
| `fetchAdminConfig` | Generated helper — Kit `Rpc` + AdminConfig PDA |

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getInitializeInstruction`, `getAssignMintInstruction`, `getSetOwnerInstruction`, `getRemoveOwnerInstruction`, `getCreateConfigInstruction`, `getSetAdminInstruction`, `getSetIssuerInstruction`, `getSetMinterInstruction`, `getClosePhygitalTokenInstruction`, …
- Accounts: `fetchPhygitalToken`, `fetchAdminConfig`, `findAdminConfigPda`, `PhygitalToken`, `AdminConfig`, …
- Types: `PhygitalTokenType` (`Permanent` | `Bearer` | `Controlled`), `Secp256r1Pubkey`, …

## Rust client

Crate: `phygital-token-client` at `packages/rust/phygital-token`.

On-chain: instruction builders, CPI helpers (`AssignMintCpiBuilder`, `SetOwnerCpiBuilder`, `CreateConfigCpiBuilder`, …), account layouts, errors.

`PhygitalTokenType`: `Permanent` (0, immutable owner, stays locked), `Bearer` (1), `Controlled` (2, lock/forfeit).

Off-chain (`fetch` feature): RPC account fetching helpers.

Check `isVerified` before issuing a session; freshness, single-use challenge consumption and session policy remain your responsibility.
