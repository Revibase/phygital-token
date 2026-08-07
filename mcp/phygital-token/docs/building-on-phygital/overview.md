# Building on phygital assets

Third-party developers can:

- **Authenticate off-chain** with a live NFC tap → `startAuthentication` + `verifyResponse`
- **Transfer ownership on-chain** → `beginTransfer` / `completeTransfer` (`execute_transfer`)
- **Initialize assets** → `buildInitializeInstruction` (chip `identifier` + passkey)

## Off-chain authentication

1. **Client:** `startAuthentication(expectedMessage)` — NFC tap.
2. **Server:** `verifyResponse({ expectedMessage, response })` — signature check → `{ isVerified, secp256r1PublicKey }` (`response.id` is the compressed secp256r1 key, reused as the WebAuthn credential id).
3. **Optional:** `fetchAssetsByPublicKey(rpc, secp256r1PublicKey)` to load on-chain state. PDA is seeded by chip `identifier`, which is distinct from the passkey.

Does **not** write to chain. Use for UI login and vault presence checks.

## On-chain ownership

```
beginTransfer({ rpc, asset })
        ↓
authenticatePasskeyForTransfer(session)
        ↓
completeTransfer(session, response, recipient)  // passkey from response.id
        ↓
send [secp256r1_verify, execute_transfer]
```

`beginTransfer` only needs `rpc` and the asset PDA. The passkey is taken from `response.id` in `completeTransfer`. `execute_transfer` updates `asset.owner` only — there is no SPL token / Token-2022 linkage.

## Message design checklist

- [ ] Issue a fresh `expectedMessage` per session (short TTL)
- [ ] Verify on the server with `verifyResponse` — never trust a client-side “success”
- [ ] Never reuse off-chain challenges across authorization scopes
- [ ] For transfers, use the slot-bound transfer challenge — not a free-form string

## Packages

**TypeScript:** `phygital-token-sdk` — `startAuthentication`, `verifyResponse`, `beginTransfer`, `completeTransfer`, `buildInitializeInstruction`

**Rust:** `phygital-token-client` at `clients/rust/phygital-token` — instruction builders / CPI helpers for `initialize`, `execute_transfer`, `remove_ownership`, `set_lock_state`
