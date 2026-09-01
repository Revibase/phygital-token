# Verification overview

Phygital authentication always requires a **live NFC tap**. There is no signed-URL / prior-scan identification helper in the SDK.

## Decision tree

```
Need the holder physically present?
└─ YES (always for auth)
    ├── Need on-chain ownership change?
    │     YES → beginTransfer({ rpc, secp256r1Pubkey }) → completeTransfer (transfer_ownership)
    │     NO  → Need on-chain possession proof for your program?
    │           YES → buildMessageHash → authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })
    │                 → buildSecp256r1VerifyInstruction
    │                 [secp256r1_verify, your_program_instruction] — program CPIs verify
    │           NO  → Server issues challenge
    │                 → startAuthentication(message, rpc) (client tap)
    │                 → verifyResponse (server verify)
    │                 → optional: findPhygitalTokenPda + fetchPhygitalToken
    └── Know the passkey already?
          → findPhygitalTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)
```

## WebAuthn credential id

Custom authenticators use the compressed secp256r1 public key as `credential.id` (33 bytes).

Browser NFC uses a random 16-byte placeholder in `allowCredentials` to trigger the system prompt. When the platform echoes that placeholder (`rawId` length 16), the SDK recovers the public key from the assertion signature. If multiple keys verify, it picks the candidate with an initialized PhygitalToken PDA on-chain.

**All browser WebAuthn paths require Kit `Rpc`** (`startAuthentication`, `authenticatePasskeyForSecp256r1Verify`, `authenticatePasskeyForTransfer`).

## Off-chain authentication

Two SDK functions:

- **`startAuthentication(message, rpc, options?)`** — client only; opens NFC and returns a WebAuthn response. Optional `rpId` in `options` defaults to `window.location.hostname`. Placeholder recovery runs when `rawId` is 16 bytes.
- **`verifyResponse`** — server only; checks the signature and returns `{ isVerified, secp256r1PublicKey }`. `response.id` / `secp256r1PublicKey` is the compressed secp256r1 vault key (33-byte passkey public key).

Neither submits a transaction. Verification should run on your backend so the client cannot fake a successful tap.

After a successful verify, look up on-chain state with `findPhygitalTokenPda(secp256r1PublicKey)` + `fetchPhygitalToken` (PDA is seeded by the passkey). Chip `identifier` is a separate binding field on the token.

## On-chain `verify` (composable)

Use `buildMessageHash(message)` then `authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })` when another program needs an on-chain possession proof. Pass the same digest to `VerifyCpiBuilder.message_hash`. Optional `expected_rp_id` / `expected_origins` are set on your CPI (`None` skips; when `expected_origins` is set, the signed origin must match one listed origin) — not on the tap helper. The phygital token PDA is derived after the NFC tap (`phygitalTokenPda`). Does **not** change `phygital_token.owner`. See [Composable verify](./verify-composable.md) and [Rust CPI](../building-on-phygital/rust-cpi.md).

## On-chain ownership change

Use `beginTransfer({ rpc, secp256r1Pubkey, rpId? })` → `authenticatePasskeyForTransfer` → `completeTransfer`. `beginTransfer` derives the phygital token PDA from the passkey. Optional `rpId` defaults to `window.location.hostname`. The passkey comes from `response.id` at complete time. That builds `secp256r1_verify` + `transfer_ownership`, which updates `phygital_token.owner` only (no SPL token).

## Message binding

- **Off-chain tap** binds `expectedMessage` (UTF-8) into the WebAuthn challenge.
- **Transfer** challenge binds the phygital token PDA + slot hash (recipient chosen later at wallet confirm).
- **verify** challenge is `messageHash` — hash with `buildMessageHash` before the tap; pass the same digest on-chain.

## Next docs

- [Verification methods](./methods.md) — `startAuthentication` / `verifyResponse`
- [Composable verify](./verify-composable.md) — CPI `verify` from your program
- [SDK surface area](../sdk/surface-area.md)
- [Building on phygital](../building-on-phygital/overview.md)
