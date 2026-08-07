# Verification methods (`verify.ts`)

All exports from `clients/js/phygital-token/src/utils/verify.ts`.

Off-chain authentication is **split**: NFC tap on the client, signature verification on your server. Every check requires a **fresh tap** — there is no signed-URL / prior-scan identification path.

## `startAuthentication(message, transceive?)`

**Client — trigger the tap.**

Opens the system NFC modal (browser) or talks to an NFC reader via `transceive` (kiosk / native). Returns a WebAuthn `AuthenticationResponseJSON`.

```ts
// Browser
const response = await startAuthentication(message);

// Kiosk / native reader
const response = await startAuthentication(message, transceive);
```

`message` must be the same string your server issued as the challenge (store server-side with a short TTL).

## `verifyResponse({ expectedMessage, response })`

**Server — verify the tap.**

Checks the WebAuthn signature against `expectedMessage`. Treats `response.id` as the compressed secp256r1 public key (the authenticator reuses that key as WebAuthn `credential.id` / `user.id`). Returns `{ isVerified, secp256r1PublicKey }` — no RPC. Challenge mismatch throws (`Message mismatch.`); a bad signature returns `isVerified: false`. Does **not** submit a transaction.

```ts
// API route after client POSTs { message, response }
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  // optional: load on-chain state by passkey
  // const assets = await fetchAssetsByPublicKey(rpc, secp256r1PublicKey)
}
```

Typical flow:

1. Server issues `message` (e.g. `randomUUID()`), stores it for the session.
2. Client calls `startAuthentication(message)` → user taps vault.
3. Client POSTs `{ message, response }` to your verify API.
4. Server calls `verifyResponse`, then runs your business logic.

## When to use what

| Need | Use |
|------|-----|
| UI login / vault gate, no tx | `startAuthentication` + `verifyResponse` |
| Load on-chain state after a tap | `verifyResponse` → `fetchAssetsByPublicKey` |
| Transfer ownership | `beginTransfer({ rpc, asset })` → `completeTransfer` (passkey from `response.id`) |

## Message binding

| Context | `message` type | Effect |
|---------|----------------|--------|
| `startAuthentication` / `verifyResponse` | `string` (`expectedMessage`) | WebAuthn challenge bytes (UTF-8); must match on client and server |
| `beginTransfer` | slot-bound challenge | Built from asset PDA + slot hash — not the same as `expectedMessage` |

An off-chain `expectedMessage` does **not** change on-chain ownership. Use the transfer flow when you need `execute_transfer`.
