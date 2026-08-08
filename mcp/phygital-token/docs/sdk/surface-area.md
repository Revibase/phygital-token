# SDK surface area

TypeScript package: `phygital-token-sdk` (`clients/js/phygital-token`).

## Initialize

| Export | Purpose |
|--------|---------|
| `buildInitializeInstruction` | Create asset PDA (seeded by passkey `secp256r1Pubkey`) |
| `parseSecp256r1Pubkey` / `parseIdentifier` | Parse base64url 33-byte compressed values |

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer({ rpc, asset })` | Slot-bound transfer challenge (no passkey arg) |
| `authenticatePasskeyForTransfer` | WebAuthn NFC tap |
| `completeTransfer` | Uses `response.id` as passkey; builds `secp256r1_verify` + `execute_transfer` |

## Verify asset (on-chain composable)

| Export | Purpose |
|--------|---------|
| `beginVerifyAsset({ rpc, message })` | Slot-bound challenge for arbitrary message |
| `authenticatePasskeyForVerifyAsset` | WebAuthn NFC tap |
| `buildVerifyAssetArgs` | Derives PDA from tap; secp ix + verify args (Pattern B) |
| `completeVerifyAsset` | Builds `secp256r1_verify` + `verify_asset` |
| `buildVerifyAssetChallenge` | Challenge helper: `SHA256("verify_asset" \|\| SHA256(message) \|\| slotHash)` |

See `verification:verify-asset-composable` and `building-on-phygital:rust-cpi`.

## Remove ownership

| Export | Purpose |
|--------|---------|
| `getRemoveOwnershipInstruction` | Wallet-signed forfeiture — reset `asset.owner` to default |

## Verification (off-chain only)

| Export | Purpose |
|--------|---------|
| `startAuthentication` | Client: NFC tap trigger; returns WebAuthn response |
| `verifyResponse` | Server: verify tap signature; returns `{ isVerified, secp256r1PublicKey }` |

Pair `startAuthentication` (client) with `verifyResponse` (server). Every auth check needs a fresh tap — there is no signed-URL identification helper.

The authenticator uses the secp256r1 public key as WebAuthn `credential.id`; the on-chain PDA is seeded by that same public key. Chip `identifier` is a separate binding field on the asset.

## Asset lookup

| Export | Purpose |
|--------|---------|
| `findAssetPda` | Derive asset PDA from passkey public key |
| `fetchAssetByIdentifier` | `getProgramAccounts` memcmp on chip `identifier` |
| `fetchAllAssetsFromOwner` | List assets by wallet owner |
| `fetchAsset` | Generated helper — load a known asset PDA |

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getInitializeInstruction`, `getExecuteTransferInstruction`, `getVerifyAssetInstruction`, `getRemoveOwnershipInstruction`, `getSetLockStateInstruction`, ...
- Accounts: `fetchAsset`, `Asset`, ...
- Types: `AssetType`, `Secp256r1Pubkey`, ...

## Rust client

Crate: `phygital-token-client` at `clients/rust/phygital-token`.

On-chain: instruction builders, CPI helpers (`VerifyAssetCpiBuilder`, `ExecuteTransferCpiBuilder`, …), account layouts, errors.

Off-chain (`fetch` feature): RPC account fetching helpers.
