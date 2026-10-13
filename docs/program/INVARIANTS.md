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
— `src/webauthn/mod.rs`; `tests/verify_flow.rs`, `tests/set_owner_webauthn_coverage.rs`, `tests/wallet_accessory_gate.rs`.

**T3. The user was present.** The authenticator data's UP flag is set.
— `src/webauthn/mod.rs`; `tests/set_owner_webauthn_coverage.rs`.

**T4. Each assertion is accepted at most once per token.** The authenticator's sign
count must exceed `last_sign_count`, which is then updated.
— `PhygitalToken::accept_assertion` in `src/state/phygital_token.rs`; `tests/set_owner_flow.rs`, `tests/verify_flow.rs`, `tests/wallet_accessory_gate.rs`.

**T5. Challenges cannot be reused across actions or for long.** `set_owner` and the
execute instructions sign domain-tagged challenges ("transfer", "execute") that
include the token and a slot hash that must still be in the SlotHashes sysvar
(the latest 512 slots).
— `src/webauthn/challenge.rs`, `src/sysvar/slot_hashes.rs`; `tests/set_owner_challenge.rs`, `tests/set_owner_security.rs`, `tests/wallet_accessory_gate.rs`.
`verify` takes the caller's `message_hash` as the challenge; freshness and domain
separation are the caller's responsibility.

## Ownership

**O1. A Controlled or Permanent token with an owner cannot change owner by tap.**
`set_owner` requires `!is_locked()`.
— `src/instructions/token/set_owner.rs`; `tests/set_owner_flow.rs`, `tests/e2e_scenarios.rs`.

**O2. A Permanent token's owner is set at creation and never changes.** `initialize`
requires an owner exactly for Permanent tokens; `remove_owner` refuses them, and
O1 blocks `set_owner`.
— `src/state/phygital_token.rs`, `src/instructions/token/remove_owner.rs`; `tests/remove_owner.rs`.

**O3. A new owner never inherits the previous owner's policy.** `set_owner` (when
the owner changes), `remove_owner` and `close_phygital_token` close the policy.
— `close_policy_if_exists` in `src/policy/mod.rs`; `tests/wallet_policy_close.rs`.

## Wallet execution

**W1. Only the owner, or a tap within the owner's policy, signs as the wallet.**
`execute_with_owner` requires the owner's signature; `execute_with_accessory`
requires an owner, a policy stored for this token and wallet, and a tap.
— `src/instructions/execute/`; `tests/wallet_owner_execute.rs`, `tests/wallet_accessory_gate.rs`.

**W2. A tap authorizes exactly the instructions and accounts it signed.** The execute
challenge covers every inner instruction's program, accounts (with signer and
writable flags) and data.
— `build_execute_challenge` in `src/webauthn/challenge.rs`; `tests/wallet_accessory_gate.rs`.

**W3. Execution cannot be wrapped or deferred.** Execute instructions must be top
level and the transaction may not use a durable nonce.
— `src/wallet/guards.rs`; `tests/wallet_owner_execute.rs` (durable nonce). The CPI case has no test yet: it needs a caller program.

**W4. Inner instructions cannot reach the program's own state.** They may not call
this program, and the token (and on the tap path the policy) may not be passed
as signer or writable.
— `src/wallet/cpi.rs`; `tests/wallet_owner_execute.rs`.

**W5. The wallet stays a plain system account.** Its owner program and data length
must be unchanged after the inner instructions.
— `src/wallet/cpi.rs`; `tests/wallet_owner_execute.rs`.

**W6. On the tap path, every inner instruction is allowed by the policy.** Unlisted
programs are blocked; restricted programs need a matching rule.
— `src/policy/matcher.rs`; `tests/wallet_policy_flow.rs`, unit tests in that module.

**W7. On the tap path, every SOL or token decrease is charged to a cap.** Each
tracked account is measured separately; a decrease with no cap fails; caps
enforce a per-window total and a per-execute maximum.
— `src/wallet/spend.rs`, `src/policy/caps.rs`; `tests/wallet_policy_flow.rs`, `tests/wallet_attacks.rs`.

**W8. On the tap path, the wallet keeps control of its token accounts.** No delegate
remains, no tracked account changes owner, mint or close authority, and no new
wallet account gets a foreign close authority.
— `charge` in `src/wallet/spend.rs`; `tests/wallet_policy_flow.rs`, `tests/wallet_attacks.rs`.

## Policy storage

**P1. The in-place policy reader agrees with the Borsh encoding.** `PolicyView`
offsets and the matcher's enum tags match the derived encoding.
— `src/policy/view.rs`, `src/policy/matcher.rs`; unit tests in those modules.

**P2. Stored permissions are unambiguous.** One entry per program, never this
program; restricted programs have rules; no rule's selector prefixes another's;
argument and account constraints fit the declared data length and account count.
— `validate_permissions` in `src/policy/permissions.rs`; unit tests there, `tests/wallet_policy_update.rs`.

## Failure behavior

**F1. Byte parsers fail with an error rather than panicking.** The crate denies
`unwrap`, `expect` and `panic` outside tests, and contains no `unsafe` blocks.
— `src/lib.rs`; property tests in `webauthn/`, `sysvar/`, `wallet/token_account.rs`, `policy/view.rs`.
