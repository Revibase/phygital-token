# Secure Signer — Threat Model

The signer iframe is a **non-custodial browser-side signing boundary** for the
**Revibase passkey wallet** (an ed25519 key that can own phygital accessories).
The parent app is treated as **potentially fully XSS-compromised**.

## Trust boundary

```
UNTRUSTED                                 TRUSTED
parent app (portal.*) ── postMessage ──►  signer origin (signer.*)
- untrusted D1 backup of ciphertext       - generates/holds the key only transiently
- untrusted tx requester                   - partitioned-cookie ciphertext for sign/export
- may lie, replay, swap blobs/txs          - independent tx decode + policy
                                           - trusted confirm UI + per-op WebAuthn PRF
```

Everything crossing into the signer is attacker-controlled (§44). The signer
independently derives or cryptographically verifies anything security-sensitive.
The parent only ever legitimately receives: public keys, signatures,
and generic results/errors. Encrypted wallet blobs stay on the signer origin
(a partitioned HttpOnly `/vault` cookie + direct restore/PUT to the app worker's backup API).

## What it defends against

| Threat                                     | Defense                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent XSS reads the private key           | Key generated + decrypted only in the signer origin; never posted in plaintext; per-op WebAuthn; export is a dedicated in-iframe ceremony.                                      |
| Malicious storage / stolen blob            | Blob is public ciphertext at rest in D1; PRF→HKDF→AES-256-GCM; holding it reveals nothing without the passkey. Parent XSS no longer receives restore ciphertext. |
| Backup squatting (someone registers a backup under your credential id first) | Backups are keyed by credential id **and** the passkey key it registered; restore verifies the assertion against each candidate, so a squatter's row (a self-made `none` attestation proves nothing) can't block or replace yours. At most 3 backups per credential id. |
| Blob substitution (wallet A shown, B used) | AAD binds {pubkey, credentialId, salt, rpId}; after decrypt the derived pubkey must match; the trusted UI shows the **derived** key, never a parent label.                      |
| Transaction substitution after confirm     | Validated message bytes are copied + frozen; authorization is single-use and bound to their SHA-256; the exact frozen bytes are signed (no re-encode → no parser differential). |
| Arbitrary signing oracle                   | Top-level allowlist (phygital-token owner instructions, ATA createIdempotent, ComputeBudget, secp256r1 beside a link); the wallet must be a required signer and every signing role (owner, recipient); inner spend is clear-signed; per-tx WebAuthn. The fee payer and the `update_policy` funder may be anyone (a Revibase fee payer when the owner has no SOL): they only pay, and are shown ("Network fee: Free" for Revibase's pool, else the address). A refill to the fee payer is shown as "Refill network fees". |
| Sign-in replay to another site/account     | `SIGN_MESSAGE` only signs a message whose first line names the parent site and whose second line is this wallet's address.                                                      |
| Replay                                     | Random requestId + freshness window + duplicate rejection + single-use authorization.                                                                                           |
| Message injection                          | `event.origin` **and** `event.source === window.parent`; strict schema (unknown fields/types/versions rejected); size caps before parsing.                                      |
| Signer-origin XSS                          | Strict CSP (`script-src 'self'`, no `unsafe-inline`/`eval`), no third-party runtime JS, no innerHTML/inline handlers, self-hosted hashed assets, build-time inline guard.       |
| Decryption oracle                          | All decrypt/auth failures collapse to one generic code.                                                                                                                         |
| DoS by parent                              | Accepted for availability; confidentiality/integrity preserved. Operations are serialized.                                                                                      |

## What it explicitly does NOT defend against (§42 — no false claims)

- **Holding up an accessory's prepaid fees.** The fee service reserves the fee for an owner transaction before the owner has signed it, until its blockhash expires, so anyone can briefly tie up that balance. No funds move; accepted for availability.

- **Signer-origin XSS or a malicious browser extension** with host access to the
  signer origin. If the signer origin itself is compromised, the key is exposed.
  Minimizing the signer's code and dependencies is mitigation, not a guarantee.
- **The user being socially engineered** through the export ceremony. WebAuthn
  proves presence, not comprehension — a user can click through a clear-signed
  screen. Clickjacking of a framed signer cannot be fully prevented (the signer
  is, by design, framed and cannot frame-bust); the out-of-page WebAuthn modal
  and in-iframe danger warnings are partial mitigations.
- **On-chain behavior inside the allowed program.** Program-ID allowlisting does
  not constrain what phygital-token does via CPI. As the accessory's owner this
  key may run anything as the accessory wallet (`execute_with_owner` is not
  limited by tap payments); the signer clear-signs the inner instructions and
  flags anything it can't decode as critical, but does not block them.
- **Secure memory erasure.** JavaScript cannot guarantee wiping. Buffers we own
  are best-effort zeroed; copies made by the runtime are not under our control.
- **Loss of the sole passkey.** With no synced copy, the wallet is unrecoverable
  (see PRF matrix). This is an accepted trade of the recovery model.

## WebAuthn PRF portability (recovery)

Recovery relies on the **same PRF output** being available for the same synced
passkey on another device. This is authenticator/browser-dependent.

| Ecosystem                                  | PRF            | Cross-device (synced) recovery   |
| ------------------------------------------ | -------------- | -------------------------------- |
| iCloud Keychain (Safari/iOS/macOS)         | Yes            | Yes, within the Apple ecosystem  |
| Google Password Manager (Chrome, Android)  | Yes            | Yes, within the Google ecosystem |
| 1Password (browser extension, iOS/Android) | Yes            | Yes, within 1Password            |
| Windows Hello (platform)                   | Yes (get-time) | Device-bound — no sync           |
| Hardware security keys (FIDO2)             | Yes (get-time) | Device-bound — no sync           |
| Firefox                                    | **No PRF**     | Not supported — fails closed     |
| Cross-ecosystem (Apple ↔ Google)           | n/a            | Not portable today               |

If PRF is unavailable, the signer **throws** rather than weakening encryption
(§11). Document to users: use a synced, PRF-capable passkey and keep it; there is
no seed/multi-credential backup (accepted decision).

## Key residual risks to revisit

1. **Recovery/backup** — a lost sole passkey strands funds. A future version
   could add an encrypted seed backup or multi-credential enrollment.
2. **Shared RP ID** — other Revibase passkeys (the authority signer) share
   `rpId` `revibase.com`. Domain separation (distinct PRF salt, HKDF label, blob magic
   and backup table) keeps the wallets apart; a discoverable restore that picks
   the other kind of passkey gets `NOT_FOUND`.
3. **Shared RP ID enrollment** — passkeys are created on the **app** origin
   (`rpId` = `revibase.com` / `localhost`) so Safari can register. The signer
   iframe only runs `get` + PRF and wraps the ed25519 seed. The parent must never
   receive PRF output or seed material.
