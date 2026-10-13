# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- `set_owner`: the tap's challenge now names the recipient,
  `SHA256("transfer" ‖ token ‖ slot_hash ‖ recipient)`, so a tap can only make
  the wallet it was made for the owner. Previously anyone who saw the
  assertion before it landed could submit it with themselves as recipient.
- The secp256r1 offsets must reference the precompile instruction itself
  (`signature/public_key/message_instruction_index == u16::MAX`). Previously a
  signature by any key in another instruction could vouch for a different
  key, letting anyone pass `verify`, `set_owner` and `execute_with_accessory`.

## [0.8.0]

First public release.
