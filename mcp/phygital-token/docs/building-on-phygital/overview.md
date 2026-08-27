# Building on phygital tokens

Third-party developers can:

- **Authenticate off-chain** with a live NFC tap → `startAuthentication` + `verifyResponse`
- **Prove possession on-chain** (composable) → `beginVerify` / `completeVerify` (`verify`)
- **Transfer ownership on-chain** → `beginTransfer` / `completeTransfer` (`transfer_ownership`)
- **Initialize tokens** → `buildInitializeInstruction` (passkey seeds PDA; chip `identifier` stored for binding)
- **Bind an SPL mint** → `buildSetMintInstruction` (`set_mint`)

## Off-chain authentication

1. **Client:** `startAuthentication(expectedMessage)` — NFC tap.
2. **Server:** `verifyResponse({ expectedMessage, response })` — signature check → `{ isVerified, secp256r1PublicKey }` (`response.id` is the compressed secp256r1 key, reused as the WebAuthn credential id).
3. **Optional:** `findTokenPda(secp256r1PublicKey)` + `fetchPhygitalToken` to load on-chain state. PDA is seeded by the passkey; chip `identifier` is a separate binding field.

Does **not** write to chain. Use for UI login and vault presence checks.

## On-chain `verify` (composable)

```
beginVerify({ messageHash })
        ↓
authenticatePasskeyForVerify(session)
        ↓
completeVerify / buildVerifyArgs  // PDA from response.id
        ↓
Pattern A: [secp256r1_verify, verify, your_ix]
Pattern B: [secp256r1_verify, your_ix]  // your program CPIs verify
```

Token PDA is derived after the NFC tap from `response.id`. See `verification:verify-composable` and `building-on-phygital:rust-cpi`.

`verify` advances `last_sign_count` and emits `VerifyEvent` — it does **not** change `token.owner`.

## On-chain ownership

```
beginTransfer({ rpc, token })
        ↓
authenticatePasskeyForTransfer(session)
        ↓
completeTransfer(session, response, recipient)  // passkey from response.id
        ↓
send [secp256r1_verify, transfer_ownership]
```

`beginTransfer` only needs `rpc` and the token PDA. The passkey is taken from `response.id` in `completeTransfer`. `transfer_ownership` updates `token.owner` only — there is no SPL token / Token-2022 linkage.

## Message design checklist

- [ ] Issue a fresh `expectedMessage` per session (short TTL)
- [ ] Verify on the server with `verifyResponse` — never trust a client-side “success”
- [ ] Never reuse off-chain challenges across authorization scopes
- [ ] For transfers, use the slot-bound transfer challenge — not a free-form string
- [ ] For composable on-chain proofs, bind your canonical payload as `verify` `messageHash` (32 bytes)

## Packages

**TypeScript:** `phygital-token-sdk` — `startAuthentication`, `verifyResponse`, `beginVerify`, `beginTransfer`, `completeTransfer`, `buildInitializeInstruction`, `buildSetMintInstruction`

**Rust:** `phygital-token-client` at `clients/rust/phygital-token` — instruction builders / CPI helpers for `initialize`, `verify`, `transfer_ownership`, `remove_ownership`, `set_lock_state`, `set_mint`
