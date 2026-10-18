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

- The generated `getSetOwnerInstruction` no longer takes `policy` or `wallet`.
  `PhygitalToken.walletBump` is now `reserved`.

### Changed

- `beginTransfer` takes `recipient`. The `set_owner` challenge names that wallet,
  and `completeTransfer` requires the same signer.

## [1.10.0]

First public release.
