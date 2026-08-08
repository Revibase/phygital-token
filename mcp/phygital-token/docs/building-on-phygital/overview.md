# Building on phygital assets

Third-party developers can:

- **Authenticate off-chain** with a live NFC tap → `startAuthentication` + `verifyResponse`
- **Prove possession on-chain** (composable) → `beginVerifyAsset` / `completeVerifyAsset` (`verify_asset`)
- **Transfer ownership on-chain** → `beginTransfer` / `completeTransfer` (`execute_transfer`)
- **Initialize assets** → `buildInitializeInstruction` (passkey seeds PDA; chip `identifier` stored for binding)

## Off-chain authentication

1. **Client:** `startAuthentication(expectedMessage)` — NFC tap.
2. **Server:** `verifyResponse({ expectedMessage, response })` — signature check → `{ isVerified, secp256r1PublicKey }` (`response.id` is the compressed secp256r1 key, reused as the WebAuthn credential id).
3. **Optional:** `findAssetPda(parseSecp256r1Pubkey(secp256r1PublicKey))` + `fetchAsset` to load on-chain state. PDA is seeded by the passkey; chip `identifier` is a separate binding field.

Does **not** write to chain. Use for UI login and vault presence checks.

## On-chain `verify_asset` (composable)

```
beginVerifyAsset({ messageHash })
        ↓
authenticatePasskeyForVerifyAsset(session)
        ↓
completeVerifyAsset / buildVerifyAssetArgs  // PDA from response.id
        ↓
Pattern A: [secp256r1_verify, verify_asset, your_ix]
Pattern B: [secp256r1_verify, your_ix]  // your program CPIs verify_asset
```

Asset PDA is derived after the NFC tap from `response.id`. See `verification:verify-asset-composable` and `building-on-phygital:rust-cpi`.

`verify_asset` advances `last_sign_count` and emits an event — it does **not** change `asset.owner`.

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
- [ ] For composable on-chain proofs, bind your canonical payload as `verify_asset` `messageHash` (32 bytes)

## Packages

**TypeScript:** `phygital-token-sdk` — `startAuthentication`, `verifyResponse`, `beginVerifyAsset`, `beginTransfer`, `completeTransfer`, `buildInitializeInstruction`

**Rust:** `phygital-token-client` at `clients/rust/phygital-token` — instruction builders / CPI helpers for `initialize`, `verify_asset`, `execute_transfer`, `remove_ownership`, `set_lock_state`
