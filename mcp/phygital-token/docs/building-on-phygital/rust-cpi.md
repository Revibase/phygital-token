# Rust: building on `verify`

Crate: `phygital-token-client` (`phygital_token_client`).

Client sends `secp256r1_verify` + your instruction (no client-side `verify`). Your program CPIs:

```rust
use phygital_token_client::generated::instructions::VerifyCpiBuilder;
use phygital_token_client::generated::types::Secp256r1VerifyArgs;

VerifyCpiBuilder::new(phygital_token_program)
    .phygital_token(phygital_token) // phygitalTokenPda from the tap
    .instructions_sysvar(instructions_sysvar) // your accounts
    .secp256r1_verify_args(secp256r1_verify_args) // from the tap
    .message_hash(message_hash) // same digest as buildMessageHash(message)
    .expected_rp_id("app.example".into()) // optional; omit to skip
    .expected_origins(vec![
        "https://app.example".into(),
        "http://localhost:3000".into(),
    ]) // optional; omit to skip
    .invoke()?;
```

The client obtains `phygitalTokenPda` and `secp256r1VerifyArgs` from TypeScript `buildSecp256r1VerifyInstruction`. `message_hash` and `instructions_sysvar` come from your instruction. Pass `phygitalTokenPda` as `VerifyCpiBuilder.phygital_token`.

`expected_rp_id` and `expected_origins` are `Option` args on `verify`. Omit the builder methods to skip those checks. When `expected_origins` is set (`Some(vec![...])`), the signed `clientDataJSON.origin` must match one entry. The tap helper's `rpId` only selects which WebAuthn relying party the browser uses — it is not the on-chain origin allow-list.

`secp256r1_verify` must appear earlier in the transaction (client includes it before your instruction).

## `Secp256r1VerifyArgs`

```rust
pub struct Secp256r1VerifyArgs {
    pub verify_args_relative_index: i64,
    pub signed_message_index: u8,
    pub client_data_json: Vec<u8>,
}
```

`verify_args_relative_index` is the index of the secp256r1 verify instruction relative to the phygital instruction (typically `-1` when secp immediately precedes verify/transfer).

## Challenge

`message_hash` is `SHA-256(message)` — hash with TypeScript `buildMessageHash` (or equivalent) before the tap. Pass the same digest to `authenticatePasskeyForSecp256r1Verify` and `VerifyCpiBuilder.message_hash`. Callers that need slot freshness or action-type domain separation must fold those into `message` before hashing.

## Testing

`programs/phygital-token/tests/verify_flow.rs`
