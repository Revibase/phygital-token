# Program invariants

What the program guarantees, where it is enforced, and which tests hold it.
Paths are relative to `programs/phygital-token/`.

## Taps

**T1. A tap is accepted only if the token's passkey signed exactly these bytes.**
The secp256r1 precompile verifies the signature before the program runs. The
program then reads the public key and signed message from the precompile
instruction's own data, and requires every offsets entry to point there
(`instruction_index == u16::MAX`). Otherwise a signature by another key, located
in another instruction, could vouch for bytes the passkey never signed.
— `src/webauthn/secp256r1.rs`; `tests/secp256r1_offsets.rs`, unit tests in that module.

**T2. The assertion answers this instruction's challenge.** `clientDataJSON.type`
is `webauthn.get`, `clientDataJSON.challenge` equals the expected 32 bytes, and
the signed message ends with `SHA256(clientDataJSON)`.
— `src/webauthn/mod.rs`; `tests/set_owner_webauthn_coverage.rs`, `tests/verify_flow.rs`.

**T3. The user was present.** The authenticator data's UP flag is set.
— `src/webauthn/mod.rs`; `tests/set_owner_webauthn_coverage.rs`.

**T4. Each assertion is accepted at most once per token.** The authenticator's sign
count must exceed `last_sign_count`, which is then updated.
— `PhygitalToken::accept_assertion` in `src/state/phygital_token.rs`; `tests/set_owner_flow.rs`, `tests/verify_flow.rs`, `tests/e2e_scenarios.rs`.

**T5. Challenges cannot be reused for other tokens, other wallets, or for long.** `set_owner` signs
a domain-tagged challenge ("transfer") that includes the token, the recipient, and a slot hash
that must still be in the SlotHashes sysvar (the latest 512 slots).
`verify` takes the caller's `message_hash` under its own domain tag; freshness is the caller's responsibility.
— `src/webauthn/challenge.rs`, `src/sysvar/slot_hashes.rs`; `tests/set_owner_challenge.rs`, `tests/set_owner_security.rs`.

## Ownership

**O1. A Controlled or Permanent token with an owner cannot change owner by tap.**
`set_owner` requires `!is_locked()`.
— `src/instructions/token/set_owner.rs`; `tests/set_owner_flow.rs`, `tests/e2e_scenarios.rs`.

**O2. A Permanent token's owner is set at creation and never changes.** `initialize`
requires an owner exactly for Permanent tokens; `remove_owner` refuses them, and
O1 blocks `set_owner`.
— `src/state/phygital_token.rs`, `src/instructions/token/remove_owner.rs`; `tests/remove_owner.rs`.

## Failure behavior

**F1. Malformed input fails with a typed error.** The crate denies
`unwrap`, `expect` and `panic` outside tests, and contains no `unsafe` blocks.

**F2. Arithmetic and indexing fail closed.** The release profile sets
`overflow-checks = true`, so an overflowing operation aborts the transaction
instead of wrapping, and an out-of-range slice index aborts it too. Clippy's
`arithmetic_side_effects` and `indexing_slicing` lints flag 37 such sites; each
was reviewed and is bounded by a check just before it (a length check, a
`checked_*` offset, a fixed-size layout or a loop bound), so none is reachable
in practice. They are left as plain operations rather than converted to new
error variants, which would change the program's error codes.
— `src/lib.rs`; property tests in `webauthn/` and `sysvar/`.
