# Building on phygital tokens

Third-party developers can:

- **Authenticate off-chain** with a live NFC tap → `startAuthentication(message, rpc)` + `verifyResponse`
- **Prove possession on-chain** (composable) → `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })` / `buildSecp256r1VerifyInstruction` (`verify` CPI)
- **Set linked wallet on-chain** → `beginTransfer({ rpc, secp256r1Pubkey })` / `completeTransfer` (`set_linked_wallet`)
- **Initialize tokens** → `findPhygitalTokenPda` + `getInitializeInstruction` (passkey seeds PDA; chip `identifier` stored for binding)
- **Bind an SPL mint** → `getSetMintInstruction` (`set_mint`)

## WebAuthn credential id

Custom authenticators use the compressed secp256r1 public key as `credential.id` (33 bytes). Browser NFC uses a random 16-byte placeholder in `allowCredentials`; when the platform echoes it (`rawId` length 16), the SDK recovers the public key from the signature and disambiguates via on-chain PhygitalToken PDAs. **Browser taps require Kit `Rpc`.**

## Off-chain authentication

1. **Client:** `startAuthentication(expectedMessage, rpc)` — NFC tap. Optional `rpId` in options defaults to `window.location.hostname`.
2. **Server:** `verifyResponse({ expectedMessage, response })` — signature check → `{ isVerified, secp256r1PublicKey }` (`response.id` is the compressed secp256r1 passkey public key; recovered on the client when `rawId` is 16 bytes).
3. **Optional:** `findPhygitalTokenPda(secp256r1PublicKey)` + `fetchPhygitalToken` to load on-chain state. PDA is seeded by the passkey; chip `identifier` is a separate binding field.

Does **not** write to chain. Use for UI login and vault presence checks.

## On-chain `verify` (composable)

```
buildMessageHash(message)
        ↓
authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })
        ↓
buildSecp256r1VerifyInstruction(tap)  // phygitalTokenPda from tap
        ↓
[secp256r1_verify, your_program_instruction]  // your program CPIs verify
```

Hash with `buildMessageHash`, then tap. Pass the same digest to `VerifyCpiBuilder.message_hash`. Token PDA is derived after the NFC tap from `response.id`. Optional `.expected_rp_id(...)` / `.expected_origins(...)` are set on your CPI — omit them to skip; when `expected_origins` is set, the signed origin must match one entry. See `verification:verify-composable` and `building-on-phygital:rust-cpi`.

`verify` advances `last_sign_count` — it does **not** change `phygital_token.linked_wallet`.

## On-chain linked wallet

```
beginTransfer({ rpc, secp256r1Pubkey, rpId? })
        ↓
authenticatePasskeyForTransfer(session)
        ↓
completeTransfer(session, response, recipient)  // passkey from response.id
        ↓
send [secp256r1_verify, set_linked_wallet]
```

`beginTransfer` takes Kit `Rpc` and base64url `secp256r1Pubkey`; it derives the phygital token PDA internally. Optional `rpId` defaults to `window.location.hostname`. The passkey is taken from `response.id` in `completeTransfer`. `set_linked_wallet` updates `phygital_token.linked_wallet` only — there is no SPL token / Token-2022 linkage.

Token types:

- **Permanent** — `linked_wallet` must be set at `initialize`; `set_linked_wallet` and `remove_linked_wallet` are rejected (`PermanentLinkedWalletImmutable`). Discriminant `0` remaps former Controlled accounts.
- **Bearer** — freely re-transferable by passkey possession.
- **Controlled** — must be unlocked (`is_locked == 0`) before transfer; re-locks after claim; forfeit via `remove_linked_wallet` to unlock.

## Message design checklist

- [ ] Issue a fresh `expectedMessage` per session (short TTL)
- [ ] Verify on the server with `verifyResponse` — never trust a client-side “success”
- [ ] Pass Kit `Rpc` to all browser WebAuthn tap helpers
- [ ] Never reuse off-chain challenges across authorization scopes
- [ ] For transfers, use the slot-bound transfer challenge — not a free-form string
- [ ] For composable on-chain proofs, hash `message` with `buildMessageHash` before the tap. Fold freshness or domain separation into `message` before hashing.

## Packages

**TypeScript:** `phygital-token-sdk` — `startAuthentication`, `verifyResponse`, `buildMessageHash`, `authenticatePasskeyForSecp256r1Verify`, `buildSecp256r1VerifyInstruction`, `beginTransfer`, `completeTransfer`, `getInitializeInstruction`, `getSetMintInstruction`

**Rust:** `phygital-token-client` at `packages/rust/phygital-token` — instruction builders / CPI helpers for `initialize`, `verify`, `set_linked_wallet`, `remove_linked_wallet`, `set_mint`
