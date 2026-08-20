# SDK surface area

TypeScript package: `phygital-token-sdk` (`clients/js/phygital-token`).

## Initialize

| Export | Purpose |
|--------|---------|
| `buildInitializeInstruction` | Create token PDA (seeded by passkey `secp256r1Pubkey`) |
| `buildSquadsInitializeInstructions` | One tx: create + propose + approve + execute + close (reclaim rent); accepts `initializeInputs[]` |
| `parseSecp256r1Pubkey` / `parseIdentifier` | Parse base64url 33-byte compressed values |
| `ADMIN` / `INITIALIZE_MULTISIG_PDA` | Admin vault and Squads multisig constants |

`ADMIN` (`G6k…EjoF`) is Squads vault-0 of `INITIALIZE_MULTISIG_PDA` (`EU7…Kn7U`). Pass the current squad member as `member` when calling `buildSquadsInitializeInstructions` (members may rotate). Returns create → propose → approve → execute → close in one instruction list.

## Set mint

| Export | Purpose |
|--------|---------|
| `buildSetMintInstruction` | Bind an SPL mint pubkey onto `token.mint` (authority defaults to `ADMIN`) |
| `buildSquadsSetMintInstructions` | Same Squads wrap as initialize; accepts `setMintInputs[]` |

`set_mint` authority must be `ADMIN`. The authority account is a signer but is **not** writable.

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer({ rpc, token })` | Slot-bound transfer challenge (no passkey arg) |
| `authenticatePasskeyForTransfer` | WebAuthn NFC tap |
| `completeTransfer` | Uses `response.id` as passkey; builds `secp256r1_verify` + `transfer_ownership` |

## Verify (on-chain composable)

| Export | Purpose |
|--------|---------|
| `beginVerify({ messageHash })` | Uses `messageHash` directly as WebAuthn challenge |
| `authenticatePasskeyForVerify` | WebAuthn NFC tap |
| `buildVerifyArgs` | Derives PDA from tap; secp ix + verify args (Pattern B) |
| `completeVerify` | Builds `secp256r1_verify` + `verify` |
| `buildVerifyChallenge` | Returns `messageHash` as-is (32 bytes) |

See `verification:verify-composable` and `building-on-phygital:rust-cpi`.

## Remove ownership

| Export | Purpose |
|--------|---------|
| `getRemoveOwnershipInstruction` | Wallet-signed forfeiture — reset `token.owner` to default |

## Verification (off-chain only)

| Export | Purpose |
|--------|---------|
| `startAuthentication` | Client: NFC tap trigger; returns WebAuthn response |
| `verifyResponse` | Server: verify tap signature; returns `{ isVerified, secp256r1PublicKey }` |

Pair `startAuthentication` (client) with `verifyResponse` (server). Every auth check needs a fresh tap — there is no signed-URL identification helper.

The authenticator uses the secp256r1 public key as WebAuthn `credential.id`; the on-chain PDA is seeded by that same public key. Chip `identifier` is a separate binding field on the token.

## Token lookup

| Export | Purpose |
|--------|---------|
| `findTokenPda` | Derive token PDA from passkey public key |
| `fetchTokenByIdentifier` | `getProgramAccounts` memcmp on chip `identifier` |
| `fetchAllTokensFromOwner` | List tokens by wallet owner |
| `fetchPhygitalToken` | Generated helper — load a known token PDA |

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getInitializeInstruction`, `getTransferOwnershipInstruction`, `getVerifyInstruction`, `getRemoveOwnershipInstruction`, `getSetLockStateInstruction`, `getSetMintInstruction`, ...
- Accounts: `fetchPhygitalToken`, `PhygitalToken`, ...
- Types: `PhygitalTokenType`, `Secp256r1Pubkey`, ...

## Rust client

Crate: `phygital-token-client` at `clients/rust/phygital-token`.

On-chain: instruction builders, CPI helpers (`VerifyCpiBuilder`, `SetMintCpiBuilder`, `TransferOwnershipCpiBuilder`, …), account layouts, errors.

Off-chain (`fetch` feature): RPC account fetching helpers.
