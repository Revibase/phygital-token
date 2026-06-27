# Building on phygital assets

Third-party developers can:

- **Gate off-chain** by wallet holdings → `evaluateAssetGating`
- **Require live passkey presence on-chain** → composable `verify_asset` (two patterns below)

## Two on-chain composition patterns

Both start with the same client flow: `beginVerifyAsset` → NFC tap → `buildVerifyAssetArgs`.

### Pattern A — Client posts `verify_asset`, your program inspects

| Layer | Responsibility |
|-------|----------------|
| **Client** | `[secp256r1_verify, verify_asset, your_ix]` via `completeVerifyAsset` |
| **Your program** | Read instructions sysvar; find preceding `verify_asset`; verify `message` bytes |

Best when your program is a consumer of an already-executed proof. Reference: `phygital-spend`.

### Pattern B — Client posts `secp256r1_verify`, your program CPIs `verify_asset`

| Layer | Responsibility |
|-------|----------------|
| **Client** | `[secp256r1_verify, your_ix]` — pass `Secp256r1VerifyArgs` + `message` in your ix data |
| **Your program** | CPI `verify_asset` via `VerifyAssetCpiBuilder` (`phygital-token-client`) |

Best when your program orchestrates verification as part of its own instruction.

## Off-chain authentication (no `verify_asset`)

`verifyWithChallengeResponse` proves presence in the client only. It does **not** write to chain. Use for UI login when no program needs to inspect `verify_asset`.

## Message design checklist

- [ ] Define domain-separated `message` bytes (prefix + action fields)
- [ ] Same bytes in `beginVerifyAsset({ message })` and your program's check
- [ ] Never reuse messages across authorization scopes

## Crates

**TypeScript:** `phygital-token-sdk` — `buildVerifyAssetArgs`, `completeVerifyAsset`, `getVerifyAssetInstruction`

**Rust:** `phygital-token-client` at `clients/rust/phygital-token` — `VerifyAssetCpiBuilder`, `Secp256r1VerifyArgs`

See [rust-cpi.md](./rust-cpi.md).
