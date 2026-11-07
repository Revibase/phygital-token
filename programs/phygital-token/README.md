# phygital-token (program)

This Solana program binds each Revi card, an NFC card that holds one P-256 key, to a token, so tapping the card can claim the token.

Program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ`, built with Anchor 1.2.1. Module map: [`src/lib.rs`](src/lib.rs). Security reports and verifying the deployed program: [SECURITY.md](../../SECURITY.md).

## Accounts

| Account | Address | Created by | Closed by |
| --- | --- | --- | --- |
| `AdminConfig` | `["admin"]` | `create_config` | never |
| `PhygitalToken` | `["token", x(card key)]` | `initialize` | `close_phygital_token` |

`x(card key)` is the 32-byte x coordinate of the card's compressed public key.

## Instructions

| Instruction | Signer | Checks | Effect |
| --- | --- | --- | --- |
| `create_config` | payer | config doesn't exist yet | payer becomes admin |
| `set_admin` / `set_issuer` / `set_minter` | admin | new key isn't default and holds no role | replaces the role |
| `initialize` | issuer | an owner is given exactly when the token is Permanent | creates the token, with its `mint` if one is given |
| `assign_mint` | minter | — | sets `mint` (informational only) |
| `close_phygital_token` | admin | — | closes the token |
| `set_owner` | recipient | see below | owner becomes the recipient |
| `remove_owner` | owner | token isn't Permanent | clears the owner |

`set_owner` needs a secp256r1 precompile instruction earlier in the same transaction. In it, the token's card must have signed `authorize ‖ SHA256("t" ‖ token ‖ recipient ‖ slot_hash)`. The program also checks:

- the token isn't locked (a Controlled or Permanent token that already has an owner);
- the slot hash is still in SlotHashes, which keeps the last 512 slots;
- `slot_number` is greater than the token's `last_slot`.

## Guarantees

- **Only the card's key can authorize a tap.** The precompile's offsets must point into the precompile instruction itself. Otherwise a signature by another key could vouch for bytes the card never signed.
- **A tap can't be replayed or redirected.** The challenge names the token, the recipient and a recent slot hash, and `last_slot` only goes up.
- **Owners are protected.** A locked token can't change owner by tap. A Permanent token's owner is set at creation and never changes.
- **Bad input fails cleanly.** Malformed input fails with a typed error. The crate has no `unwrap`, `expect`, `panic` or `unsafe` outside tests, and it builds with `overflow-checks` on.

## Trust assumptions

- The issuer chooses each token's key, type and first owner.
- The admin can close tokens and rotate roles.
- `create_config` makes its first caller the admin. Call it right after deploying and confirm the admin. A front-run can be fixed by upgrading the program.

## Develop

| Tool | Version | Pinned in |
| --- | --- | --- |
| Rust | 1.98.1 | `rust-toolchain.toml` |
| Solana CLI / Anchor CLI | 4.3.2 / 1.2.1 | `Anchor.toml` |

```bash
NO_DNA=1 anchor build    # the tests load target/deploy/phygital_token.so
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo deny check
```

The program's public interface is its instruction names and arguments, account layouts, PDA seeds and error codes.

- Errors are append-only, because clients match on the number.
- After a change, run `pnpm build:program` from the repo root and commit the regenerated `idl/` and SDK `src/generated/`. Never edit those by hand.
- Add a LiteSVM test for every new check, including the failure path.
- Record releases in [CHANGELOG.md](CHANGELOG.md). A release that changes the IDL needs a new SDK release.
