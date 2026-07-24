# SDK surface area

TypeScript package: `phygital-token-sdk` (`clients/js/phygital-token`).

## Mint

| Export | Purpose |
|--------|---------|
| `buildCreateMintInstructions` | Create design mint in a collection |
| `buildMintTokenInstructions` | Mint token + initialize asset PDA |
| `parseSecp256r1Pubkey` | Parse base64url compressed P-256 key |
| `parseCredentialId` | Parse base64url credential id |
| `validateMetadataFields` | Name/symbol/uri length checks |

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer` | Slot-bound transfer challenge |
| `authenticatePasskeyForTransfer` | WebAuthn NFC tap |
| `completeTransfer` | `secp256r1_verify` + `execute_transfer` |

## Remove ownership

| Export | Purpose |
|--------|---------|
| `getRemoveOwnershipInstructionAsync` | Wallet-signed forfeiture — return token to custody and reset `asset.owner` |

## Verify asset (composable)

| Export | Purpose |
|--------|---------|
| `beginVerifyAsset` | Slot-bound verify challenge for custom `message` |
| `authenticatePasskeyForVerifyAsset` | WebAuthn NFC tap |
| `buildVerifyAssetArgs` | Build secp256r1 + resolve asset after tap |
| `completeVerifyAsset` | Full instruction pair |

## Verification (client helpers — off-chain only)

| Export | Purpose |
|--------|---------|
| `verifyDynamicUrl` | Identification via signed URL (server) |
| `verifyDynamicUrlWithoutCounterCheck` | Identification offline |
| `startAuthentication` | Client: NFC tap trigger; returns WebAuthn response |
| `verifyResponse` | Server: verify tap signature; returns `{ isVerified, asset }` |

Pair `startAuthentication` (client) with `verifyResponse` (server). Pass optional `transceive` for kiosk / native NFC readers. Optional `fetchAssetFromCredentialIdCallback` must return an `Asset`. Owner wallet is `asset.owner`.

On-chain proof always uses `beginVerifyAsset` / `buildVerifyAssetArgs` / `completeVerifyAsset`.

## Asset lookup & metadata

| Export | Purpose |
|--------|---------|
| `findAssetPda` | Derive asset PDA from secp256r1 pubkey |
| `fetchAssetFromCredentialId` | Resolve asset + pubkey from credential |
| `fetchAllAssetsFromOwner` | List assets by wallet owner |
| `fetchAssetDisplayInfoFromPublicKey` | Rich display metadata from base64url pubkey |
| `fetchAssetDisplayInfo` | Rich display metadata from a decoded `Asset` account |
| `fetchShortcutsFromExternalUrl` | Load Phantom Shortcuts schema v2 from `{external_url}/shortcuts.json` |
| `resolveMedia` | Resolve media URLs from token metadata |

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getCreateMintInstructionAsync`, `getMintTokenInstructionAsync`, `getExecuteTransferInstructionAsync`, `getRemoveOwnershipInstructionAsync`, `getVerifyAssetInstruction`, `getSetLockStateInstruction`, ...
- Accounts: `fetchAsset`, `Asset`, ...
- Types: `AssetType`, `Secp256r1VerifyArgs`, `CredentialId`, ...
- PDAs: `findProgramAuthorityPda`, ...

## Rust client

Crate: `phygital-token-client` at `clients/rust/phygital-token`.

On-chain: instruction builders, CPI helpers, account layouts, errors.

Off-chain (`fetch` feature): RPC account fetching helpers.
