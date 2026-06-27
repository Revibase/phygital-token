# phygital-token-client

Codama-generated Rust client for the [phygital-token](https://github.com/jychab/phygital-nfts) Solana program.

## Install

```toml
[dependencies]
phygital-token-client = "0.1"
```

For on-chain CPI helpers (Anchor):

```toml
phygital-token-client = { version = "0.1", features = ["anchor"] }
```

For off-chain account fetching:

```toml
phygital-token-client = { version = "0.1", features = ["fetch"] }
```

## Usage

The crate re-exports generated instruction builders, account layouts, types, and errors from `phygital_token_client::generated`.

```rust
use phygital_token_client::{
    instructions::VerifyAssetCpiBuilder,
    types::Secp256r1VerifyArgs,
    PHYGITAL_TOKEN_ID,
};
```

Regenerate from the program IDL with `pnpm generate:rust-client` at the monorepo root.

## License

ISC
