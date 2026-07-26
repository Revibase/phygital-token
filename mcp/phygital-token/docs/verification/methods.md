# Verification methods (`verify.ts`)

All exports from `clients/js/phygital-token/src/utils/verify.ts`.

## Identification (no second tap)

### `verifyDynamicUrl(params, callback?)`

**Use when:** User already tapped once; you have signed URL query params (`pk`, `s`, `c`, `n`).

### `verifyDynamicUrlWithoutCounterCheck(params)`

**Use when:** Offline device, no verification server. Copied links can be replayed.

## Authentication — off-chain only (live tap)

Off-chain authentication is **split**: NFC tap on the client, signature verification on your server.

### `startAuthentication(message, transceive?)`

**Client — trigger the tap.**

Opens the system NFC modal (browser) or talks to an NFC reader via `transceive` (kiosk / native). Returns a WebAuthn `AuthenticationResponseJSON`.

```ts
// Browser
const response = await startAuthentication(message);

// Kiosk / native reader
const response = await startAuthentication(message, transceive);
```

`message` must be the same string your server issued as the challenge (store server-side with a short TTL).

### `verifyResponse({ expectedMessage, response })`

**Server — verify the tap.**

Checks the WebAuthn signature against `expectedMessage`. Treats `response.id` as the compressed secp256r1 public key (the authenticator reuses that key as WebAuthn `credential.id` / `user.id`). Returns `{ isVerified, secp256r1PublicKey }` — no RPC. Challenge mismatch throws (`Message mismatch.`); a bad signature returns `isVerified: false`. Does **not** submit `verify_asset`.

```ts
// API route after client POSTs { message, response }
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  // optional: load on-chain state
  // await fetchAssetDisplayInfoFromSecp256r1PublicKey(rpc, secp256r1PublicKey)
}
```

Typical flow:

1. Server issues `message` (e.g. `randomUUID()`), stores it for the session.
2. Client calls `startAuthentication(message)` → user taps vault.
3. Client POSTs `{ message, response }` to your verify API.
4. Server calls `verifyResponse`, then runs your business logic.

For on-chain proof with a bound message, use `beginVerifyAsset({ message: Uint8Array })` instead.

## Off-chain auth vs on-chain composable

| Need | Use |
|------|-----|
| UI login / vault gate, no tx | `startAuthentication` + `verifyResponse` |
| On-chain proof — Pattern A | `completeVerifyAsset` + your ix |
| On-chain proof — Pattern B | `buildVerifyAssetArgs` + your ix |
| Transfer ownership | `beginTransfer` → `completeTransfer` |

## Message: off-chain vs on-chain

| Context | `message` type | Effect |
|---------|----------------|--------|
| `startAuthentication` / `verifyResponse` | `string` (`expectedMessage`) | WebAuthn challenge bytes (UTF-8); must match on client and server |
| `beginVerifyAsset` | `Uint8Array` | Hashed into slot-bound on-chain challenge |

An off-chain `expectedMessage` does **not** produce an on-chain `verify_asset` record. Use the composable flow when your program must inspect or CPI `verify_asset`.
