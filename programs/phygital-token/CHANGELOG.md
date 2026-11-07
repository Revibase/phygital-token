# Changelog

All notable changes to this artifact are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed

- **The accessory wallet:** `update_policy`, `close_policy`, `execute_with_owner`, `execute_with_accessory`, `preview_execute`, `AccessoryPolicy` and the wallet PDA. `wallet_bump` is now an unused `reserved` byte, so offsets are unchanged. Errors 6022–6037 are no longer raised.
- **The `verify` instruction.** Check the secp256r1 precompile against the token's key instead.

### Changed

- **New tap message.** `set_owner` checks only the secp256r1 precompile. The card signs `authorize ‖ SHA256("t" ‖ token ‖ recipient ‖ slot_hash)` (41 bytes), and any other message fails with `ChallengeHashMismatch`.
- **Replay protection** now requires `slot_number > last_slot`, replacing `last_sign_count`.
- **`Secp256r1VerifyArgs`** is now `relative_index` and `signature_index`, and the `webauthn` module is renamed `tap`.
- **`initialize` takes a `mint`** (`InitializeArgs.mint`; `Pubkey::default()` for none), and `InitializeEvent` includes it. The issuer can set a card's mint as it creates the token, in one transaction; the minter can still change it with `assign_mint`.

### Security

- **Precompile offsets** must point into the precompile instruction itself. Before this, a signature by another key, in another instruction, could pass `set_owner`.

## [0.8.0]

First public release.
