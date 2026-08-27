# phygital-token-client

Codama-generated Rust client for the [phygital-token](https://github.com/Revibase/phygital-token) Solana program.

## Install

```toml
[dependencies]
phygital-token-client = "1.0"
```

For on-chain CPI helpers (Anchor):

```toml
phygital-token-client = { version = "1.0", features = ["anchor"] }
```

For off-chain account fetching:

```toml
phygital-token-client = { version = "1.0", features = ["fetch"] }
```

## Usage

The crate re-exports generated instruction builders, account layouts, types, and errors from `phygital_token_client::generated`.

```rust
use phygital_token_client::{
    instructions::{TransferOwnershipCpiBuilder, VerifyCpiBuilder, SetMintCpiBuilder},
    types::PhygitalTokenType,
    PHYGITAL_TOKEN_ID,
};
```

### `verify` CPI

The TypeScript SDK prepends `secp256r1_verify` and does **not** include a client-side `verify` instruction. Your program CPIs `verify`:

```rust
use phygital_token_client::generated::instructions::VerifyCpiBuilder;

VerifyCpiBuilder::new(phygital_token_program)
    .phygital_token(phygital_token) // phygitalTokenPda from the tap
    .instructions_sysvar(instructions_sysvar)
    .secp256r1_verify_args(secp256r1_verify_args) // from the tap
    .message_hash(message_hash) // same digest as buildMessageHash(message)
    .expected_rp_id("app.example".into()) // optional; omit to skip
    .expected_origins(vec![
        "https://app.example".into(),
        "http://localhost:3000".into(),
    ]) // optional; omit to skip
    .invoke()?;
```

`expected_rp_id` and `expected_origins` are `Option` args. Omit the builder methods to skip those checks. When `expected_origins` is set, the signed `clientDataJSON.origin` must match one entry.

Regenerate from the program IDL with `pnpm generate:rust-client` at the monorepo root.

## License

MIT. See [LICENSE](./LICENSE).
