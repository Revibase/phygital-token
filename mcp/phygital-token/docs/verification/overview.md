# Verification overview

Phygital authentication always requires a **live NFC tap**. There is no signed-URL / prior-scan identification helper in the SDK.

## Decision tree

```
Need the holder physically present?
└─ YES (always for auth)
    ├── Need on-chain ownership change?
    │     YES → beginTransfer → completeTransfer (transfer_ownership)
    │     NO  → Need on-chain possession proof for your program?
    │           YES → beginVerify composable flow (Pattern A or B)
    │           NO  → Server issues challenge
    │                 → startAuthentication (client tap)
    │                 → verifyResponse (server verify)
    │                 → optional: findTokenPda + fetchPhygitalToken
    └── Know the passkey already?
          → findTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)
```

## Off-chain authentication

Two SDK functions:

- **`startAuthentication`** — client only; opens NFC and returns a WebAuthn response.
- **`verifyResponse`** — server only; checks the signature and returns `{ isVerified, secp256r1PublicKey }`. `response.id` / `secp256r1PublicKey` is the compressed secp256r1 vault key (also used as the WebAuthn credential id).

Neither submits a transaction. Verification should run on your backend so the client cannot fake a successful tap.

After a successful verify, look up on-chain state with `findTokenPda(parseSecp256r1Pubkey(secp256r1PublicKey))` + `fetchPhygitalToken` (PDA is seeded by the passkey). Chip `identifier` is a separate binding field on the token.

## On-chain `verify` (composable)

Use `beginVerify({ messageHash })` when another program needs an on-chain possession proof. The token PDA is derived after the NFC tap. Does **not** change `token.owner`. See [Composable verify](./verify-composable.md) and [Rust CPI](../building-on-phygital/rust-cpi.md).

## On-chain ownership change

Use `beginTransfer({ rpc, token })` → `authenticatePasskeyForTransfer` → `completeTransfer`. The passkey comes from `response.id` at complete time. That builds `secp256r1_verify` + `transfer_ownership`, which updates `token.owner` only (no SPL token).

## Message binding

- **Off-chain tap** binds `expectedMessage` (UTF-8) into the WebAuthn challenge.
- **Transfer** challenge binds the token PDA + slot hash (recipient chosen later at wallet confirm).
- **verify** challenge is `messageHash` (32 bytes) passed directly to the instruction.

## Next docs

- [Verification methods](./methods.md) — `startAuthentication` / `verifyResponse`
- [Composable verify](./verify-composable.md) — Pattern A / B
- [SDK surface area](../sdk/surface-area.md)
- [Building on phygital](../building-on-phygital/overview.md)
