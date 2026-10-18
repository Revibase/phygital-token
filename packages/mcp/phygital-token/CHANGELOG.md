# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- `list_sdk_exports` and SDK docs include the Rust CPI builders.
- `plan_transfer`, `plan_remove_owner` and the docs drop the accessory wallet
  and policy. `plan_transfer` describes the `set_owner` challenge as
  `SHA256("transfer" || token || recipient || slotHash)`
  (`beginTransfer({ rpc, secp256r1Pubkey, recipient })`).

## [1.10.0]

First public release.
