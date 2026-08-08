# Rust: building on `verify_asset`

Crate: `phygital-token-client` (`phygital_token_client`).

## Pattern A — Inspect prior `verify_asset`

Client sends `secp256r1_verify` + `verify_asset` + your instruction. Your program does **not** CPI.

1. Load `instructions_sysvar`
2. Scan instructions **before** your program's index
3. Find `phygital_token::verify_asset` for the expected `asset`
4. Decode instruction data; verify `message` matches your canonical payload

```rust
// Pseudocode
require!(decoded_message == expected_message, MyError::InvalidProof);
require!(verify_asset_asset == expected_asset, MyError::WrongAsset);
```

## Pattern B — CPI `verify_asset` from your program

Client sends `secp256r1_verify` + your instruction (no client-side `verify_asset`). Your program CPIs:

```rust
use phygital_token_client::generated::instructions::VerifyAssetCpiBuilder;
use phygital_token_client::generated::types::Secp256r1VerifyArgs;

VerifyAssetCpiBuilder::new(phygital_token_program)
    .asset(asset_account)
    .slot_hashes(slot_hashes_sysvar)
    .instructions_sysvar(instructions_sysvar)
    .secp256r1_verify_args(secp256r1_verify_args)
    .message(message_bytes)
    .invoke()?;
```

The client obtains `secp256r1_verify_args` from TypeScript `buildVerifyAssetArgs` and passes them in your instruction data.

`secp256r1_verify` must appear earlier in the transaction (client includes it before your ix).

## `Secp256r1VerifyArgs`

```rust
pub struct Secp256r1VerifyArgs {
    pub verify_args_relative_index: i64,
    pub signed_message_index: u8,
    pub slot_number: u64,
    pub client_data_json: Vec<u8>,
}
```

`verify_args_relative_index` is the index of the secp256r1 verify instruction relative to the phygital instruction (typically `-1` when secp immediately precedes verify/transfer).

## Challenge

`SHA256("verify_asset" || SHA256(message) || slotHash)`.

## Testing

`programs/phygital-token/tests/verify_asset_flow.rs`
