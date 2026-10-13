# secure-signer: security

What it defends against, what it doesn't, and PRF portability are in
[THREAT_MODEL.md](THREAT_MODEL.md). This page maps each guarantee to the tests
that hold it.

| Guarantee | Where | Tests |
|---|---|---|
| Key material (PRF output, seed, plaintext key) never leaves the signer origin | `flows/`, `keys/wallet-service.ts` | leak scan on every posted message and API body in `src/dispatcher.test.ts` |
| Only the parent frame on the configured origin is heard | `dispatcher.ts` (origin + `event.source`), `messaging/protocol.ts` (schema) | `dispatcher.test.ts` › message gate (origin, `event.source`, schema) |
| Replay and staleness refused | `messaging/state.ts` | `messaging/state.test.ts`; `dispatcher.test.ts` › freshness and replay edges |
| The exact bytes shown are the bytes signed, once | `messaging/state.ts`, `tx/decode.ts`, `tx/policy.ts` | `dispatcher.test.ts` › sign; `tx/policy.test.ts`, `fuzz.test.ts` |
| Signs only owner actions for its own address | `tx/policy.ts`, `tx/parser.ts` | `tx/policy.test.ts`; `dispatcher.test.ts` › WALLET_MISMATCH / POLICY_REJECTED |
| Sign-in messages only for the parent site and this address | `flows/sign-message.ts` (`signInMessageProblem`) | `dispatcher.test.ts` › sign message |
| Blob substitution fails | `keys/wallet-format.ts` (AAD binds pubkey, credentialId, salt, rpId) | `keys/wallet-format.test.ts`; `dispatcher.test.ts` › tampered blob, other-credential blob |
| Decrypt failures don't leak which step failed | `keys/wallet-service.ts` | `keys/wallet-service.test.ts`; `dispatcher.test.ts` |
| No inline script can run on the signer origin | `deploy/_headers.template` CSP (written to `dist/_headers` at build), `scripts/assert-no-inline.mjs` | build guard in `pnpm build` |
| The local ciphertext is readable only by the signer's own same-origin requests | `storage/vault.ts` (`__Host-`, HttpOnly, Partitioned cookie; same-origin checks, no CORS) | `storage/vault.test.ts`, `storage/blob-store.test.ts` |
| The backup API only trusts the passkey and the wallet key | `app/src/lib/server/signer/backup.ts` | `app/test/signer-backup.test.ts` |
| A backup belongs to the passkey key that registered it, not to whoever names its credential id first | `app/src/lib/server/signer/backup.ts`, migration `revibase_0011` | `app/test/signer-backup.test.ts` › squatter, cap |
| Every confirm screen says what moves, how much and to whom, in words a person can check | `src/ui/confirm-model.ts`, `src/tx/clear-sign.ts`, `src/tx/parser.ts` | `src/ui/confirm-model.test.ts` (golden screens in `src/ui/__screens__/` + readability lint) |
| The real app, signer iframe and chain hold these end to end, in Chrome and WebKit | — | `app/scripts/e2e-browser.ts` (see `app/README.md` › End to end) |

Accepted: script on the app origin could request the passkey's PRF with a user
gesture, since the app and signer share the RP ID.

## Findings from the end-to-end pass (2026-10-13)

The local end-to-end suite (`app/scripts/e2e-browser.ts`) drives the real app, the real signer iframe and a local validator in Chrome and WebKit. A virtual authenticator stands in for the passkey and the NFC accessory (`app/test/e2e/webauthn-bridge.ts`). Each finding below has a test that failed before its fix.

| # | Finding | Severity | Status | Test |
|---|---|---|---|---|
| 1 | Backups were keyed by credential id alone. A self-made `none` attestation naming someone else's credential id, with the attacker's own key, took the row first, so the owner's backup failed with `wallet_conflict` and restore checked the attacker's key. (A registration challenge doesn't help here: `none` attestations don't sign `clientDataJSON`.) | Medium (denial of backup/restore; needs the victim's credential id) | Fixed: rows are keyed by credential id **and** registered key, restore verifies against each, at most 3 per credential id | `app/test/signer-backup.test.ts` |
| 2 | Tap verification (`verifyResponse`) didn't check `clientData.type`, the user-present flag or the RP ID hash | Low | Fixed in the SDK (`expectedRpId` added); tap resume passes the app's RP ID | `packages/js/phygital-token/src/__tests__/verify-login.test.ts`, `app/test/tap-resume.test.ts` |
| 3 | The signer sheet couldn't be tapped while another sheet was open: the open dialog set `pointer-events: none` on `<body>` | High (passkey wallet unusable from the wallet picker) | Fixed in `SecureSignerHost.svelte` | e2e › passkey wallet: create |
| 4 | On the claim page, "Set up your passkey wallet" opened behind the wallet picker | High (couldn't claim with a new passkey wallet) | Fixed: passkey prompts render above other sheets | e2e › claim |
| 5 | Safari: reloading while the sign-in request was in flight disconnected and forgot the wallet | Medium | Fixed in `WalletConnect.svelte`: a dropped request isn't a refusal | e2e › reload (WebKit) |
| 6 | The permission request page sometimes stayed on "Loading current permissions and balances…" (about 1 run in 3) | Medium | Fixed: request mint details no longer wait on the holdings query | e2e › permission request (looped 8×) |
| 7 | The Memo v2 program id was wrong, so real memos showed as unknown, critical calls (the unit test used the same wrong id) | Low (readability) | Fixed | `src/tx/clear-sign.test.ts` |
| 8 | Confirm screens hid things people need: NFT recipients, amounts after the third action, permission warnings (under Details), custom rules (raw JSON), addresses inside text (not expandable), windows in raw seconds, unset v1 settings shown as 0, raw amounts without units | Medium (readability) | Fixed | `src/ui/confirm-model.test.ts` |
| 9 | The signer iframe's `allow` delegated WebAuthn and clipboard to `*` | Low (defence in depth; the response header already limited it) | Fixed: delegated to the signer origin only | e2e › passkey wallet: create |
| 10 | `/api/signer/*` parsed request bodies of any size | Low | Fixed: 16 KiB cap, refused unread | `app/test/signer-backup.test.ts` › signer API route |

**Accepted, documented:**
- The fee service reserves an accessory's prepaid fee for owner transactions that aren't signed yet, until their blockhash expires, so anyone can briefly hold up that balance. Pinned by `app/test/sponsor.test.ts` (unsigned owner transactions are accepted).
- Restore doesn't track the passkey's signature counter: synced passkeys report 0. Each restore challenge is single-use.

**Open, needs a decision:** there is no rate limiting on `/api/signer/*-challenge`, `/api/owner/challenge` or `/api/sponsor/sign`. Each is an unauthenticated D1 write. The proposed fix is a Workers rate-limit binding keyed by client IP.

**Verified, no change needed:** the hostile-parent suite. Script on the app origin posting straight to the signer gets refusals before any confirm screen for bad versions, unknown fields, stale or future timestamps, replayed ids, oversized messages, sign-in for another site or address, foreign programs, another owner, lookup tables, durable nonces and double secp256r1 verifies. Unreadable inner calls reach the owner only as critical, behind "Authorize anyway". A foreign site framing the signer gets no replies. The leak scan finds no PRF output in anything posted to the app, sent over the network or stored by the app.
