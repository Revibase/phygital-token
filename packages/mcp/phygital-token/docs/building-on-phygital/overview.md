# Building on phygital tokens

Third-party developers can:

- **Authenticate off-chain** (Web2 passkey login) → `startAuthentication(message, { rpc, allowList? })` / `verifyResponse` → your session
- **Prove possession on-chain** (composable) → `buildMessageHash` / `authenticatePasskeyForSecp256r1Verify({ rpc, allowList?, messageHash, transceive? })` / `buildSecp256r1VerifyInstruction` (`verify` CPI)
- **Set linked wallet on-chain** → `beginTransfer({ rpc, secp256r1Pubkey })` / `authenticatePasskeyForTransfer` / `completeTransfer` (`set_linked_wallet`)
- **Bootstrap roles** → `getCreateConfigInstruction` → `getSetIssuerInstruction` / `getSetMinterInstruction`
- **Initialize tokens** → `findPhygitalTokenPda` + `getInitializeInstruction` (issuer-only; passkey seeds PDA; chip `identifier` stored for binding)
- **Bind an SPL mint** → `getAssignMintInstruction` (`assign_mint`; minter-only)
- **Close a token** → `getClosePhygitalTokenInstruction` / `getClosePhygitalTokenInstructionAsync` (`close_phygital_token`; admin-only; reclaim rent to `rentRecipient`)

## Roles

`AdminConfig` is a singleton with three distinct pubkeys:

| Role | Who sets it | What it can do |
|------|-------------|----------------|
| **admin** | `create_config` signer; transferable via `set_admin` | `set_admin`, `set_issuer`, `set_minter`, `close_phygital_token` |
| **issuer** | admin via `set_issuer` | `initialize` only |
| **minter** | admin via `set_minter` | `assign_mint` only |

## WebAuthn credential id

Custom authenticators use the compressed secp256r1 public key as `credential.id` (33 bytes). Browser NFC uses a random 16-byte placeholder in `allowCredentials`; when the platform echoes it (`rawId` length 16), the SDK recovers the public key from the signature and disambiguates via on-chain PhygitalToken PDAs (`rpc`), or against your `allowList` when no `rpc` is given. **When `allowList` is passed, the tapped credential id must always be in it.**

All tap helpers share `authenticatePasskey`: pass `{ transceive }` for native/kiosk APDU; omit for browser WebAuthn. For APDU, `rpId`/`origin` are optional (empty defaults).

## Off-chain authentication (Web2 passkey login)

1. **Server:** issue any short-lived `message` string → store single-use → return `{ challengeId, message }`.
2. **Client:** `startAuthentication(message, { rpc, allowList? })` — NFC tap (prefetch message before the click for iOS). Native: `startAuthentication(message, { transceive })`.
3. **Client → server:** `POST { challengeId, response }`.
4. **Server:** `verifyResponse({ expectedMessage: message, response })`.
5. **Server:** on `isVerified`, map `secp256r1PublicKey` → user (`findPhygitalTokenPda` + `fetchPhygitalToken` → `linkedWallet`) and **create your normal session**.

Does **not** write to chain and does **not** set a cookie for you. Does **not** check rpId/origin.
## On-chain `verify` (composable)

```
buildMessageHash(message)
        ↓
authenticatePasskeyForSecp256r1Verify({ rpc, allowList?, messageHash, transceive? })
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
authenticatePasskeyForTransfer(session, { transceive? })
        ↓
completeTransfer(session, response, recipient)  // passkey from response.id
        ↓
send [secp256r1_verify, set_linked_wallet]
```

`beginTransfer` takes Kit `Rpc` and base64url `secp256r1Pubkey`; it derives the phygital token PDA internally. Optional `rpId` defaults to `window.location.hostname`. The passkey is taken from `response.id` in `completeTransfer`. `set_linked_wallet` updates `phygital_token.linked_wallet` only — there is no SPL token / Token-2022 linkage.

**Lock rules** (`is_locked` must be `0` for every token type):

- Tokens initialized with a non-default `linked_wallet` start locked.
- **Permanent** — stays locked forever; `set_linked_wallet` always fails with `TokenIsCurrentlyLocked`; `remove_linked_wallet` rejected (`PermanentLinkedWalletImmutable`).
- **Bearer** — transferable when unlocked.
- **Controlled** — re-locks after claim; forfeit via `remove_linked_wallet` to unlock.

## Message design checklist

- [ ] Issue a fresh short-lived message challenge per login (single-use)
- [ ] Verify on the server with `verifyResponse` — never trust a client-side “success”
- [ ] Create your own session after `isVerified: true` (SDK does not set cookies)
- [ ] Pass `rpc` to `startAuthentication` / on-chain browser taps for recovery, and `allowList` to gate the tapped id (or as the no-RPC recovery fallback); `transceive` for native
- [ ] Never reuse challenges across authorization scopes
- [ ] For transfers, use the slot-bound transfer challenge — not a login message
- [ ] Ensure `is_locked == 0` before `set_linked_wallet`
- [ ] For composable on-chain proofs, hash `message` with `buildMessageHash` before the tap. Fold freshness or domain separation into `message` before hashing.

## Packages

**TypeScript:** `phygital-token-sdk` — `startAuthentication`, `verifyResponse`, `buildMessageHash`, `authenticatePasskeyForSecp256r1Verify`, `buildSecp256r1VerifyInstruction`, `beginTransfer`, `completeTransfer`, `getInitializeInstruction`, `getAssignMintInstruction`, `getCreateConfigInstruction`, `getClosePhygitalTokenInstruction`, `findAdminConfigPda`

**Rust:** `phygital-token-client` at `packages/rust/phygital-token` — instruction builders / CPI helpers for `initialize`, `verify`, `set_linked_wallet`, `remove_linked_wallet`, `assign_mint`, `create_config`, …
