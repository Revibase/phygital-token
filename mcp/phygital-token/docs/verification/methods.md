# Verification methods (`verify.ts`)

All exports from `clients/js/phygital-token/src/utils/verify.ts`.

Off-chain authentication is **split**: NFC tap on the client, signature verification on your server. Every check requires a **fresh tap** — there is no signed-URL / prior-scan identification path.

## WebAuthn credential id recovery

| `rawId` length | Meaning |
|----------------|---------|
| **33 bytes** | Authenticator returned the compressed secp256r1 public key — used as `response.id` |
| **16 bytes** | Platform echoed the random placeholder — SDK recovers the public key from the signature |

When recovery is ambiguous (multiple verifying public keys), the SDK selects the candidate whose PhygitalToken PDA exists on-chain. **Browser WebAuthn requires Kit `Rpc`** for this path.

## `startAuthentication(message, rpc, options?)`

**Client — trigger the tap.**

Opens the system NFC modal (browser) or talks to an NFC reader via `transceive` (kiosk / native). Returns a WebAuthn `AuthenticationResponseJSON`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | yes | Same string your server issued as the challenge |
| `rpc` | yes (browser) | Kit `Rpc` for placeholder recovery disambiguation |
| `options.transceive` | no | Native NFC reader; when set, skips browser WebAuthn |
| `options.rpId` | no | Relying party ID; defaults to `window.location.hostname` |

On the **browser** path, `nfcWebAuthnRequestOptions` uses a random 16-byte `allowCredentials` id so any enrolled NFC passkey can be selected. When the platform echoes that placeholder (`rawId` length 16), `authenticateWithWebauthn` recovers the compressed secp256r1 public key before returning, so `response.id` is the 33-byte vault key your server expects.

```ts
const rpc = createSolanaRpc(RPC_URL);

// Browser
const response = await startAuthentication(message, rpc);

// Kiosk / native reader (rpc unused when transceive is set)
const response = await startAuthentication(message, rpc, { transceive });
```

## `verifyResponse({ expectedMessage, response })`

**Server — verify the tap.**

Checks the WebAuthn signature against `expectedMessage`. Treats `response.id` as the compressed secp256r1 public key (the passkey vault key). On browser taps that required placeholder recovery, the client path already resolved the real key before you receive the response. Returns `{ isVerified, secp256r1PublicKey }` — no RPC. Challenge mismatch throws (`Message mismatch.`); a bad signature returns `isVerified: false`. Does **not** submit a transaction.

```ts
// API route after client POSTs { message, response }
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  // optional: load on-chain state by passkey
  // const token = await fetchPhygitalToken(
  //   rpc,
  //   await findPhygitalTokenPda(secp256r1PublicKey),
  // );
}
```

Typical flow:

1. Server issues `message` (e.g. `randomUUID()`), stores it for the session.
2. Client calls `startAuthentication(message, rpc)` → user taps vault.
3. Client POSTs `{ message, response }` to your verify API.
4. Server calls `verifyResponse`, then runs your business logic.

## When to use what

| Need | Use |
|------|-----|
| UI login / vault gate, no tx | `startAuthentication(message, rpc)` + `verifyResponse` |
| Load on-chain state after a tap | `verifyResponse` → `findPhygitalTokenPda` + `fetchPhygitalToken` |
| Look up by chip identifier | `fetchPhygitalTokenByIdentifier` |
| Transfer ownership | `beginTransfer({ rpc, secp256r1Pubkey })` → `completeTransfer` (passkey from `response.id`) |
| On-chain possession proof / CPI | `buildMessageHash` → `authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })` → `buildSecp256r1VerifyInstruction` |

## Message binding

| Context | `message` type | Effect |
|---------|----------------|--------|
| `startAuthentication` / `verifyResponse` | `string` (`expectedMessage`) | WebAuthn challenge bytes (UTF-8); must match on client and server |
| `beginTransfer` | slot-bound challenge | Built from phygital token PDA + slot hash — not the same as `expectedMessage` |
| `authenticatePasskeyForSecp256r1Verify` | `Uint8Array` (`messageHash`, 32 bytes) | WebAuthn challenge and on-chain `message_hash`. Hash with `buildMessageHash` first. |

An off-chain `expectedMessage` does **not** change on-chain ownership. Use the transfer flow when you need `transfer_ownership`. Use `verify` when another program needs an on-chain possession proof. Optional on-chain origin/rpId checks are `expected_origins: Option<Vec<String>>` and `expected_rp_id: Option<String>` on the `verify` CPI.
