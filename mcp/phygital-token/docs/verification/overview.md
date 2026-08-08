# Verification overview

Phygital authentication always requires a **live NFC tap**. There is no signed-URL / prior-scan identification helper in the SDK.

## Decision tree

```
Need the holder physically present?
└─ YES (always for auth)
    ├── Need on-chain ownership change?
    │     YES → beginTransfer → completeTransfer (execute_transfer)
    │     NO  → Need on-chain possession proof for your program?
    │           YES → beginVerifyAsset composable flow (Pattern A or B)
    │           NO  → Server issues challenge
    │                 → startAuthentication (client tap)
    │                 → verifyResponse (server verify)
    │                 → optional: fetchAssetsByPublicKey / fetchAsset
    └── Know the chip identifier already?
          → findAssetPda(identifier) / fetchAsset(rpc, pda)
```

## Off-chain authentication

Two SDK functions:

- **`startAuthentication`** — client only; opens NFC and returns a WebAuthn response.
- **`verifyResponse`** — server only; checks the signature and returns `{ isVerified, secp256r1PublicKey }`. `response.id` / `secp256r1PublicKey` is the compressed secp256r1 vault key (also used as the WebAuthn credential id).

Neither submits a transaction. Verification should run on your backend so the client cannot fake a successful tap.

After a successful verify, look up on-chain state with `fetchAssetsByPublicKey(rpc, secp256r1PublicKey)` (PDA is seeded by a separate chip `identifier`, not the passkey).

## On-chain `verify_asset` (composable)

Use `beginVerifyAsset({ rpc, asset, message })` when another program needs a slot-bound possession proof. Does **not** change `asset.owner`. See [Composable verify_asset](./verify-asset-composable.md) and [Rust CPI](../building-on-phygital/rust-cpi.md).

## On-chain ownership change

Use `beginTransfer({ rpc, asset })` → `authenticatePasskeyForTransfer` → `completeTransfer`. The passkey comes from `response.id` at complete time. That builds `secp256r1_verify` + `execute_transfer`, which updates `asset.owner` only (no SPL token).

## Message binding

- **Off-chain tap** binds `expectedMessage` (UTF-8) into the WebAuthn challenge.
- **Transfer** challenge binds the asset PDA + slot hash (recipient chosen later at wallet confirm).
- **verify_asset** challenge binds `SHA256("verify_asset" || SHA256(message) || slotHash)`.

## Next docs

- [Verification methods](./methods.md) — `startAuthentication` / `verifyResponse`
- [Composable verify_asset](./verify-asset-composable.md) — Pattern A / B
- [SDK surface area](../sdk/surface-area.md)
- [Building on phygital](../building-on-phygital/overview.md)
