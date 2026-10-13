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
  Errors 6016 (`OriginMismatch`) and 6022–6037 are no longer raised; the other
  codes are unchanged.
- The `verify` instruction. Taps are authenticated off-chain; no program used
  it by CPI, and anyone could replay a pending tap's assertion through it to
  advance the sign count and make the real `set_owner` fail. Error 6015
  (`RpIdMismatch`) is no longer raised.

### Changed

- `set_owner`'s challenge is `SHA256("transfer" ‖ token ‖ slot_hash)` again,
  without the recipient, so a tap can come before the wallet that finishes the
  claim is chosen (in-app wallet and desktop handoffs). Anyone who sees an
  assertion before it lands can submit it for themselves; this is an accepted
  limitation (see `docs/program/THREAT_MODEL.md`).

### Security

- The secp256r1 offsets must reference the precompile instruction itself
  (`signature/public_key/message_instruction_index == u16::MAX`). Previously a
  signature by any key in another instruction could vouch for a different
  key, letting anyone pass `verify` and `set_owner`.

## [0.8.0]

First public release.
