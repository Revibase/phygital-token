# Verification methods (`verify.ts`)

All exports from `clients/js/phygital-token/src/utils/verify.ts`.

## Identification (no second tap)

### `verifyDynamicUrl(params, callback?)`

**Use when:** User already tapped once; you have signed URL query params (`pk`, `s`, `c`, `n`).

### `verifyDynamicUrlWithoutCounterCheck(params)`

**Use when:** Offline device, no verification server. Copied links can be replayed.

## Authentication — off-chain only (live tap)

### `verifyWithChallengeResponse({ rpc, message?, fetchPublicKeyFromCredentialIdCallback? })`

**Use when:** Browser web app; prove holder is present **without** an on-chain transaction.

Optional `message` sets the WebAuthn challenge (UTF-8 encoded). When omitted, a random 32-byte challenge is used. This lets you bind the tap to app-specific context (e.g. session id, action label) without going on-chain.

```ts
// Random challenge
await verifyWithChallengeResponse({ rpc });

// Bound challenge (still off-chain)
await verifyWithChallengeResponse({
  rpc,
  message: `login:${sessionId}`,
});
```

Returns `{ publicKey, isVerified }`. Does **not** submit `verify_asset`.

For on-chain proof with a bound message, use `beginVerifyAsset({ message: Uint8Array })` instead.

### `verifyWithChallengeResponseOverNfc({ rpc, message?, transceive, ... })`

Same as above for React Native / native NFC apps. Optional `message` binds the challenge the same way.

## Off-chain auth vs on-chain composable

| Need | Use |
|------|-----|
| UI login, bound or random challenge, no tx | `verifyWithChallengeResponse({ message? })` |
| On-chain proof — Pattern A | `completeVerifyAsset` + your ix |
| On-chain proof — Pattern B | `buildVerifyAssetArgs` + your ix |
| Transfer ownership | `beginTransfer` → `completeTransfer` |

## Message: off-chain vs on-chain

| Context | `message` type | Effect |
|---------|----------------|--------|
| `verifyWithChallengeResponse` | optional `string` | WebAuthn challenge bytes (UTF-8) |
| `beginVerifyAsset` | `Uint8Array` | Hashed into slot-bound on-chain challenge |

An off-chain `message` in `verifyWithChallengeResponse` does **not** produce an on-chain `verify_asset` record. Use the composable flow when your program must inspect or CPI `verify_asset`.
