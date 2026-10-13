# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Breaking

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

- The generated `getSetOwnerInstruction` no longer takes `policy` or `wallet`,
  and takes `verifyArgsRelativeIndex`, `signedMessageIndex` and
  `clientDataJson` directly instead of a `secp256r1VerifyArgs` object.
  `PhygitalToken.walletBump` is now `reserved`.

- Removed `buildMessageHash`, `authenticatePasskeyForSecp256r1Verify`,
  `buildSecp256r1VerifyInstruction` and the generated `getVerifyInstruction`
  family: the program no longer has a `verify` instruction. Authenticate taps
  with `startAuthentication` and `verifyResponse`.

### Changed

- `beginTransfer` does not take a `recipient`: the `set_owner` challenge no
  longer names the new owner (matches the program), so the tap can come before
  the wallet is chosen.

## [1.10.0]

First public release.
