# phygital-token-client

Codama-generated Rust client for the [phygital-token](https://github.com/Revibase/phygital-token) Solana program.

## Install

```toml
[dependencies]
phygital-token-client = "1.9"
```

For on-chain CPI helpers (Anchor):

```toml
phygital-token-client = { version = "1.9", features = ["anchor"] }
```

For off-chain account fetching:

```toml
phygital-token-client = { version = "1.9", features = ["fetch"] }
```

## Usage

The crate re-exports generated instruction builders, account layouts, types, and errors from `phygital_token_client::generated`.

```rust
use phygital_token_client::{
    instructions::{SetOwnerCpiBuilder, AssignMintCpiBuilder},
    types::PhygitalTokenType,
    PHYGITAL_TOKEN_ID,
};
```

Regenerate from the program IDL with `pnpm generate:rust-client` at the monorepo root.

## License

MIT. See [LICENSE](./LICENSE).
