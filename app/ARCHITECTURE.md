# Revibase app architecture

See [README.md](README.md) for development, testing, and deployment. The program and SDK define the protocol. The app adds sessions and the claim flow.

## Access

| Entry | Grants |
| --- | --- |
| Signed NFC URL | Ten-minute `browse_unlock`: inspect the accessory and start a claim. |
| Wallet sign-in | Thirty-day `owner_session`. A current owner check then issues a view-only `owner_browse`. |
| Fresh WebAuthn assertion | Slot-bound approval for claiming. The connected wallet signs the transaction. |
| Owner signature | Release (`remove_owner`), without a tap. Rejected for Permanent tokens. |

An unused signed NFC URL stays valid until a newer counter is consumed. A tap does not prove wallet-key control or NFT ownership. The on-chain `owner`, the NFT holder, and the person holding the accessory can differ. Bearer can be claimed again while unlocked. Controlled must be released first. Permanent cannot change owner. Server and UI use `accessoryRules`.

The URL’s `pk` is the chip identifier, not its WebAuthn passkey. Resolve it to the token, then derive the PDA from `public_key`. The identifier-to-PDA mapping is cached in D1.

## Security

- Verify a signed tap URL before consuming the shared `tap_counters` mark. Ignore speculative prefetch. Redirect to a clean URL with `no-store` and `no-referrer`.
- A tap the server accepts must be signed on this origin for this rpId. `verifyResponse` checks `clientDataJSON.origin` against the request origin. The browser builds the claim and submits it to Solana RPC.
- Shared `auth_challenges` are single-use. Session cookies are HMAC-signed, HttpOnly, Secure, and SameSite=Lax (`__Host-` in production).
- `browse_unlock` can claim. `owner_browse` cannot. The claim page requires the fresh tap session.
- Claiming connects a wallet, then uses `beginTransfer`, `authenticatePasskeyForTransfer`, and `completeTransfer`. The program checks the recent slot hash, the token passkey, user presence, an increasing sign count, the lock, and that the tap names the recipient signer.
- The transfer challenge is `SHA256("transfer" ‖ token ‖ recipient ‖ slot_hash)`. The assertion stays in browser memory.
- Validate the transaction bytes before and after signing. Keep the approved programs, accounts, recipient, slot, and assertion. Reject unexpected signers or lookup tables.
- The program does not check origin or rpId on `set_owner`. The app checks both before it keeps a tap. Chip and passkey binding also depends on the issuer.
- Stateful APIs require same-origin requests. Claim construction, signing, and submission use the browser’s Solana RPC.
- `/api/tap/challenge`, `/api/tap/resume`, and `/api/owner/challenge` are rate-limited at the Cloudflare edge, not in the worker.

## Claim

On a phone, connect the wallet first, then prepare the challenge for that wallet before the tap. A desktop visit only shows a handoff to the phone, because the tap needs NFC. iOS WebAuthn needs a user gesture that does not wait on the network. The countdown estimates SlotHashes expiry (`TAP_WINDOW_MS`). The program is authoritative. If the assertion expires, the user taps again.

Claim transactions are v0 with compute-budget instructions. Wallet discovery and signing use `@solana/connector`. Wallet Standard signs kit 8 transaction bytes directly, because the connector uses kit 7.

## Shortcuts

Project `shortcuts.json` comes from the mint’s HTTPS `external_url`.

| Field | Opens |
| --- | --- |
| omitted, or `prefersExternalTarget: false` | In-app browser, and only when the link is the project host or a subdomain |
| `prefersExternalTarget: true` | New tab |

`solana:` links stay on the Solana Pay sheet. A shortcut carries no session or key material. The frame can ask the shell to connect and sign. The shell approves connect once per origin and account, then the connected wallet signs. A dApp registers that wallet with `registerIframeWallet({ parent: "https://portal.revibase.com" })` before it starts a connector. Registration happens only inside an iframe whose parent sent hello. A normal visit is unchanged.

“Forget wallet preference” clears the claim details shown for this accessory. It does not change where a shortcut opens, and it does not release the accessory.

Only NFT media queries persist locally. Shortcut caches include the owner address. The NFT owner badge is informational.

## Code

| Path | Responsibility |
| --- | --- |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view and claim rules, load shortcuts. |
| `src/lib/shared/link-transaction.ts` | Transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Claim, release, connector discovery, and signing. |
| `src/lib/client/wallet/embed-host.ts`, `src/lib/shared/wallet-bridge.ts` | In-app browser and the wallet injected into it. |
| `src/lib/components/app`, `src/routes` | UI, including `/accessory/link` and `/unlink/[pda]`. |

Never expose an RPC URL that contains a secret to the browser.
