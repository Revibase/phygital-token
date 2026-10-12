# secure-signer: security

What it defends against, what it doesn't, and PRF portability are in
[THREAT_MODEL.md](THREAT_MODEL.md). This page maps each guarantee to the tests
that hold it.

| Guarantee | Where | Tests |
|---|---|---|
| Key material (PRF output, seed, plaintext key) never leaves the signer origin | `dispatcher.ts`, `wallet-service.ts` | leak scan on every posted message and API body in `src/dispatcher.test.ts` |
| Only the parent frame on the configured origin is heard | `dispatcher.ts` (origin + `event.source`), `protocol.ts` (schema) | `dispatcher.test.ts` › message gate (origin, `event.source`, schema) |
| Replay and staleness refused | `state.ts` | `state.test.ts`; `dispatcher.test.ts` › freshness and replay edges |
| The exact bytes shown are the bytes signed, once | `state.ts`, `tx/decode.ts`, `tx/policy.ts` | `dispatcher.test.ts` › sign; `tx/policy.test.ts`, `fuzz.test.ts` |
| Signs only owner actions for its own address | `tx/policy.ts`, `tx/parser.ts` | `tx/policy.test.ts`; `dispatcher.test.ts` › WALLET_MISMATCH / POLICY_REJECTED |
| Sign-in messages only for the parent site and this address | `dispatcher.ts` (`signInMessageProblem`) | `dispatcher.test.ts` › sign message |
| Blob substitution fails | `wallet-format.ts` (AAD binds pubkey, credentialId, salt, rpId) | `wallet-format.test.ts`; `dispatcher.test.ts` › tampered blob, other-credential blob |
| Decrypt failures don't leak which step failed | `wallet-service.ts` | `wallet-service.test.ts`; `dispatcher.test.ts` |
| No inline script can run on the signer origin | `deploy/_headers` CSP, `scripts/assert-no-inline.mjs` | build guard in `pnpm build` |
| The local ciphertext is readable only by the signer's own same-origin requests | `vault.ts` (`__Host-`, HttpOnly, Partitioned cookie; same-origin checks, no CORS) | `vault.test.ts`, `blob-store.test.ts` |
| The backup API only trusts the passkey and the wallet key | `app/src/lib/server/signer/backup.ts` | `app/test/signer-backup.test.ts` |

Accepted: script on the app origin could request the passkey's PRF with a user
gesture, since the app and signer share the RP ID.
