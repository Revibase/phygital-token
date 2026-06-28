# Verification methods (`verify.ts`)

All exports from `clients/js/phygital-token/src/utils/verify.ts`.

## Identification (no second tap)

### `verifyDynamicUrl(params, callback?)`

**Use when:** User already tapped once; you have signed URL query params (`pk`, `s`, `c`, `n`).

### `verifyDynamicUrlWithoutCounterCheck(params)`

**Use when:** Offline device, no verification server. Copied links can be replayed.

## Authentication — off-chain only (live tap)

Off-chain authentication is **split**: NFC tap on the client, signature verification on your server.

### `startAuthenticationWithChallengeResponse(message, transceive?)`

**Client — trigger the tap.**

Opens the system NFC modal (browser) or talks to an NFC reader via `transceive` (kiosk / native). Returns a WebAuthn `AuthenticationResponseJSON`.

```ts
// Browser
const response = await startAuthenticationWithChallengeResponse(message);

// Kiosk / native reader
const response = await startAuthenticationWithChallengeResponse(message, transceive);
```

`message` must be the same string your server issued as the challenge (store server-side with a short TTL).

### `verifyWithChallengeResponse({ rpc, expectedMessage, response, ... })`

**Server — verify the tap.**

Checks the WebAuthn signature against `expectedMessage`, resolves the vault `publicKey` via RPC (or `fetchPublicKeyFromCredentialIdCallback`). Returns `{ publicKey, isVerified }`. Does **not** submit `verify_asset`.

```ts
// API route after client POSTs { message, response }
const { publicKey, isVerified } = await verifyWithChallengeResponse({
  rpc,
  expectedMessage: message,
  response,
});
```

Typical flow:

1. Server issues `message` (e.g. `randomUUID()`), stores it for the session.
2. Client calls `startAuthenticationWithChallengeResponse(message)` → user taps vault.
3. Client POSTs `{ message, response }` to your verify API.
4. Server calls `verifyWithChallengeResponse`, then runs your business logic (e.g. `evaluateAssetGating`).

For on-chain proof with a bound message, use `beginVerifyAsset({ message: Uint8Array })` instead.

## Off-chain auth vs on-chain composable

| Need | Use |
|------|-----|
| UI login / vault gate, no tx | `startAuthenticationWithChallengeResponse` + `verifyWithChallengeResponse` |
| On-chain proof — Pattern A | `completeVerifyAsset` + your ix |
| On-chain proof — Pattern B | `buildVerifyAssetArgs` + your ix |
| Transfer ownership | `beginTransfer` → `completeTransfer` |

## Message: off-chain vs on-chain

| Context | `message` type | Effect |
|---------|----------------|--------|
| `startAuthenticationWithChallengeResponse` / `verifyWithChallengeResponse` | `string` (`expectedMessage`) | WebAuthn challenge bytes (UTF-8); must match on client and server |
| `beginVerifyAsset` | `Uint8Array` | Hashed into slot-bound on-chain challenge |

An off-chain `expectedMessage` does **not** produce an on-chain `verify_asset` record. Use the composable flow when your program must inspect or CPI `verify_asset`.
