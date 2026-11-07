# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The SDK now signs payloads with a Revi card, off-chain and on-chain, alongside the generated client.

### Breaking

- **New tap protocol.** Taps use the card's product key. The card signs `authorize ‖ payload` (1–631 bytes) and returns its key and signature in the WebAuthn large blob. The WebAuthn assertion, origin and rpId are no longer checked.
- **`startAuthentication(payload, { signal? })`** takes a string or bytes and returns the response. The `allowList`, `rpc`, `rpId` and `credentialId` options are gone. A new tap closes the SDK's previous prompt.
- **`verifyResponse(response, expected)`** is synchronous. It returns `{ publicKey, signature, message }` or throws `INVALID_ASSERTION`, and it no longer returns `isVerified` or recovers the key.
- **`getSecp256r1VerifyInstruction(entries)`** replaces `buildSecp256r1VerifyInstructionFromWebAuthnResponse`.
- **Removed exports:**
  - the `set_owner` helpers: `beginTransfer`, `completeTransfer`, `authenticatePasskeyForTransfer`, `TransferSession` and `getLatestSlotHash`;
  - `authenticatePasskey`, `bufferToBase64URLString` and `decodeBase64AccountData`;
  - the `verify` instruction and its helpers.
- **Generated client.** `set_owner` takes `relativeIndex` and `signatureIndex` instead of `secp256r1VerifyArgs`. `PhygitalToken.lastSignCount` is now `lastSlot`, and `STALE_SLOT` (6023) is new.
- **Mint linkage removed.** `fetchPhygitalTokenByMint`, `getAssignMintInstruction`, `getSetMinterInstruction` and their events are gone. `PhygitalToken.mint` and `AdminConfig.minter` are now `reserved` bytes, so account sizes and the owner/identifier offsets are unchanged. `mint` is gone from `InitializeEventEvent` and `ClosePhygitalTokenEventEvent`.
- **Error codes.** `PhygitalTokenErrorCode` keeps only `INVALID_PUBLIC_KEY`, `WEBAUTHN_UNSUPPORTED`, `AUTHENTICATION_CANCELLED`, `INVALID_ASSERTION` and `INVALID_ARGUMENT`.

### Added

- `enrollCard(challenge, { signal? })` enrolls a card's product key with one tap and returns a `RegistrationResponseJSON`. Enrolling again returns the same key.
- `buildProductAllowListId`, `AUTHORIZE_PREFIX`, `MAX_AUTHORIZE_PAYLOAD`, and the `VerifiedTap` and `Secp256r1VerifyEntry` types.
- `findPhygitalTokenPda` also accepts raw key bytes.

## [2.1.0]

### Added

- `authenticatePasskey` (and `startAuthentication`) take a `signal` that cancels
  the tap prompt. Without it, a prompt left open by a closed checkout keeps the
  browser's WebAuthn request pending, and the next tap fails with "A request is
  already pending".

## [2.0.0]

### Breaking

- Requires `@solana/kit` `^8.5.0`. The regenerated client uses types that
  8.3 and 8.4 don't have.

- Generated instruction inputs (`*Input`, `*AsyncInput`) are now generic over
  `InstructionSignerInput` / `InstructionAccountInput` instead of address
  strings, so code that passes explicit type arguments must update them.
  Address fields in generated args also accept `HasAddress`.

- Removed the accessory wallet: `getPhygitalWalletSigner`, the
  `buildExecute*` / `compileWalletInstructions` helpers, the fee sponsor
  (`createSponsorFeePayer*`, `fetchSponsor`, `fetchPrepaidFees`, `planFee`,
  `AccessoryWalletTopUpRequired`, `RefillBlockedByTapLimit`, …), the Wallet
  Standard adapter (`registerPhygitalWallet`, `RevibaseAccessory`,
  `getRevibaseAccessorySession`, …), `PolicyDeniedError` and the permission
  JSON helpers (`parsePermissionSet`, `ruleToArgs`, `hexToBytes`, …),
  `getPolicyCloseAccounts`, and the generated policy, wallet and execute
  instructions, accounts and types. `verifyResponse` no longer returns
  `accessoryWallet`. The `@wallet-standard/*` dependencies are gone.

- The generated `getSetOwnerInstruction` no longer takes `policy` or `wallet`.
  `PhygitalToken.walletBump` is now `reserved`.

### Added

- Codecs and parsers for every program event: `get*EventEventCodec`,
  `parse*EventEvent`, the `*_EVENT_EVENT_DISCRIMINATOR` constants and
  `identifyPhygitalTokenEvent`.

### Changed

- `beginTransfer` takes `recipient`. The `set_owner` challenge names that wallet,
  and `completeTransfer` requires the same signer.

## [1.10.0]

First public release.
