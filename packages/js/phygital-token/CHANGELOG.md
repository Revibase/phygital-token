# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

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
