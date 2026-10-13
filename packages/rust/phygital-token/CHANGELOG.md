# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed

- The accessory wallet: `UpdatePolicy`, `ClosePolicy`, `ExecuteWithOwner`,
  `ExecuteWithAccessory`, `PreviewExecute` (with their builders and CPI
  types), the `AccessoryPolicy` account and the policy types. `SetOwner`,
  `RemoveOwner` and `ClosePhygitalToken` no longer take `policy` or `wallet`
  accounts. `PhygitalToken.wallet_bump` is renamed `reserved`.
- `VerifyCpi`, `VerifyCpiBuilder` and the other `verify` instruction types: the
  program no longer has a `verify` instruction.

## [1.9.0]

First public release.
