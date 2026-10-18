# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed

- The accessory wallet: `update_policy`, `close_policy`, `execute_with_owner`,
  `execute_with_accessory`, `preview_execute`, the `AccessoryPolicy` account
  and the wallet PDA. `set_owner`, `remove_owner` and `close_phygital_token` no
  longer take `policy` or `wallet` accounts. `PhygitalToken.wallet_bump` is now
  an unused `reserved` byte, so the layout and field offsets are unchanged.
  Errors 6022–6037 are no longer raised; the other codes are unchanged.

### Changed

- `set_owner`'s challenge is `SHA256("transfer" ‖ token ‖ recipient ‖ slot_hash)`.
  The tap names the wallet that must sign.

### Security

- The secp256r1 offsets must reference the precompile instruction itself
  (`signature/public_key/message_instruction_index == u16::MAX`). Previously a
  signature by any key in another instruction could vouch for a different
  key, letting anyone pass `verify` and `set_owner`.

## [0.8.0]

First public release.
