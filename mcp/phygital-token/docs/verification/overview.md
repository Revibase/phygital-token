# Verification overview

Phygital assets support two fundamentally different checks. Pick the wrong one and you either annoy users with unnecessary taps or accept replayable proofs.

## The two questions

| Kind | Question | User taps again? |
|------|----------|------------------|
| **Identification** | Which asset is this? | No |
| **Authentication** | Is the holder here right now? | Yes |

Think of identification like reading a signed badge from a prior scan. Think of authentication like requiring a live tap before a high-value action.

## Decision tree

```
Do you need the holder physically present right now?
├─ NO → Identification
│   ├─ Online, replay protection → verifyDynamicUrl
│   └─ Offline / no backend → verifyDynamicUrlWithoutCounterCheck (weaker)
└─ YES → Authentication
    ├─ Off-chain only (UI login, vault gate, no chain tx)
    │     Server issues challenge → startAuthentication (client tap)
    │     → verifyResponse (server verify) → your logic
    ├─ On-chain proof for your program → beginVerifyAsset composable flow (see below)
    └─ Transfer ownership → beginTransfer → completeTransfer (NOT verify_asset)
```

## Off-chain vs on-chain authentication

Off-chain authentication uses two SDK functions:

- **`startAuthentication`** — client only; opens NFC and returns a WebAuthn response.
- **`verifyResponse`** — server only; checks the signature and returns `{ isVerified, secp256r1PublicKey }`. `response.id` / `secp256r1PublicKey` is the compressed secp256r1 vault key (also used as the WebAuthn credential id). Load on-chain state with `fetchAssetDisplayInfoFromSecp256r1PublicKey` or `fetchAsset` when needed.

Neither submits a transaction. Verification should run on your backend so the client cannot fake a successful tap.

For on-chain proof that a passkey holder signed a specific message at a specific slot, use the composable `beginVerifyAsset` flow.

## Two ways to compose on-chain with your program

Both patterns start the same on the client: `beginVerifyAsset` → tap → `buildVerifyAssetArgs` (or `completeVerifyAsset`).

| Pattern | Client transaction | Your on-chain program |
|---------|-------------------|----------------------|
| **A — Inspect** | `[secp256r1_verify, verify_asset, your_ix]` | Scans instructions sysvar for a preceding `verify_asset`; checks `message` bytes |
| **B — CPI** | `[secp256r1_verify, your_ix]` | CPIs `phygital_token::verify_asset` using args from `buildVerifyAssetArgs` |

### Pattern A — Client posts `verify_asset`, program inspects

The client includes the full `verify_asset` instruction (via `completeVerifyAsset` or `getVerifyAssetInstruction`). Your program runs **after** it and reads the instructions sysvar to confirm a matching `verify_asset` ran with the expected `message`.

Reference: `phygital-spend` — `require_matching_verify_asset`.

### Pattern B — Client posts `secp256r1_verify`, program CPIs `verify_asset`

The client uses `buildVerifyAssetArgs` to get `secp256r1Verify` and the verify args, but does **not** include `verify_asset` in the transaction. Your program receives those args (via instruction data) and CPIs `verify_asset` via `VerifyAssetCpiBuilder` from `phygital-token-client`.

`secp256r1_verify` must still appear **before** your program's instruction in the transaction.

## Message binding

- **Transfer** challenge binds the asset PDA (recipient chosen later at wallet confirm).
- **Verify asset** challenge binds arbitrary `message` bytes. Hash on-chain: `SHA256(message)`.
- **Dynamic URL** binds `counter || nonce` (uint32 BE + 8 random bytes).
- **Off-chain tap** binds `expectedMessage` (UTF-8) into the WebAuthn challenge.

Embed domain-specific bytes in `message` so a proof for one action cannot authorize another.

## Slot freshness

`verify_asset` records `asset.last_transfer_slot`. Each verification must use a **strictly greater** slot. Complete the flow promptly after `beginVerifyAsset` (~512 slots).

## Next docs

- [Verification methods](./methods.md) — every `verify.ts` export
- [Composable verify_asset](./verify-asset-composable.md) — `buildVerifyAssetArgs` and both patterns
- [Building on phygital](../building-on-phygital/overview.md)
