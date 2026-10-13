# phygital-token (on-chain program)

Program id `phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz`, built with Anchor 1.0.2.

Each physical accessory carries a P-256 passkey. The program records that key
in a token account and accepts a **tap** (a WebAuthn assertion verified by the
secp256r1 precompile) as proof that the accessory was present. On that basis it
offers authentication (`verify`), ownership (`set_owner`, `remove_owner`) and an
optional wallet PDA per token that the owner, or a tap within the owner's
policy, can sign for.

- Start at [`src/lib.rs`](src/lib.rs) for the module map.
- Invariants: [`docs/program/INVARIANTS.md`](../../docs/program/INVARIANTS.md).
- Threat model: [`docs/program/THREAT_MODEL.md`](../../docs/program/THREAT_MODEL.md).
- Terms: [`GLOSSARY.md`](../../GLOSSARY.md).

## Accounts

| Account | Address | Created by | Closed by |
|---------|---------|------------|-----------|
| `AdminConfig` | `["admin"]` | `create_config` | never |
| `PhygitalToken` | `["token", x(passkey)]` | `initialize` | `close_phygital_token` |
| `AccessoryPolicy` | `["policy", token]` | `update_policy` | `close_policy`, or any owner change |
| wallet (no data) | `["wallet", token]` | never (system account) | never |

`x(passkey)` is the 32-byte x coordinate of the compressed public key.

## Instructions

"Tap" means a WebAuthn assertion by the token's passkey, in a secp256r1
precompile instruction earlier in the same transaction, over the challenge
listed. Every accepted tap must carry a higher sign count than the last.

| Instruction | Must sign | Checks | Effect |
|-------------|-----------|--------|--------|
| `create_config` | payer | config PDA does not exist | payer becomes admin |
| `set_admin` / `set_issuer` / `set_minter` | admin | new key is not default and holds no role | replaces the role key |
| `initialize` | issuer | Permanent ⇔ an owner is given | creates the token; sign count 0 |
| `assign_mint` | minter | — | sets `mint` (informational) |
| `close_phygital_token` | admin | token PDA matches its key | closes the token and its policy; the wallet keeps its assets |
| `set_owner` | `recipient` | not locked; tap over `SHA256("transfer" ‖ token ‖ slot_hash)`; slot in SlotHashes | owner = `recipient`; a different owner closes the policy |
| `remove_owner` | owner | not Permanent | owner cleared; policy closed |
| `verify` | — | tap over the caller's `message_hash`; optional rpId and origin list | sign count recorded |
| `update_policy` | owner, payer | edits valid; permissions valid | creates or resizes the policy |
| `close_policy` | owner | policy belongs to token and wallet | policy closed, rent to the wallet |
| `execute_with_owner` | owner | top level; no durable nonce; no call into this program; token not privileged | inner instructions signed as the wallet |
| `execute_with_accessory` | — | as above, plus: owner set; policy loaded; tap over the execute challenge; origin allowed; every inner instruction allowed; every spend capped; wallet owner and size unchanged | inner instructions signed as the wallet; caps charged |
| `preview_execute` | — | as `execute_with_accessory` without the tap | always fails; `PreviewPassed` if it would succeed |

The execute challenge is
`SHA256("execute" ‖ token ‖ slot_hash ‖ borsh(instructions) ‖ accounts)`, where
`accounts` lists, for each inner instruction's program and accounts, the key
and its signer/writable flags ([`src/webauthn/challenge.rs`](src/webauthn/challenge.rs)).

## Build and test

```bash
NO_DNA=1 anchor build   # program, IDL
cargo test              # unit tests and LiteSVM integration tests (load target/deploy/phygital_token.so)
```

From the repository root, `pnpm build:program` also regenerates the TypeScript
and Rust clients from the IDL. Reproducible builds: see
[`docs/audit/BUILD.md`](../../docs/audit/BUILD.md).
