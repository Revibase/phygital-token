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

Every transaction the app builds is v1 (up to 4096 bytes; a claim with two WebAuthn verifies doesn't reliably fit v0's 1232). Its compute limit, priority fee and loaded-data limit live in the message header (`LINK_TX_CONFIG`), not in compute-budget instructions; v1 budgets zero for an unset limit. Privy connects embedded Solana wallets and external Wallet Standard wallets. Those wallets sign kit 8 transaction bytes directly and pay their own fees.

## Project apps

Project apps come from `revibase.json` at the mint’s HTTPS `external_url`. It is Revibase’s own format, not Phantom’s `shortcuts.json`, so a project can serve both without one affecting the other. Only `"version": 1` is read.

| `open` | Opens |
| --- | --- |
| `embed` | In-app browser, and only when the link is the project host or a subdomain |
| `tab` | New tab, any HTTPS host |

An app link carries no session or key material. The frame can ask the shell to connect and sign. The shell approves connect once per origin and account, then the connected wallet signs. A dApp registers that wallet with `registerIframeWallet({ parent: "https://portal.revibase.com" })` before it starts a connector. Registration happens only inside an iframe whose parent sent hello. A normal visit is unchanged.

Any app can send someone into the Revibase wallet with a browse link in the same schema as Phantom, Solflare and Backpack: `/ul/browse/<url-encoded page URL>?ref=<url-encoded origin>`. The link is stateless: `/ul/browse` checks only that the page is http(s) and opens it in the in-app browser, fragment included. `ref` is accepted for compatibility and ignored, since anyone writing the link can put any origin there; the page is labelled by its own hostname. Connecting from that page asks the person the first time, like any other site, and they still approve every transaction.

“Forget wallet preference” clears the claim details shown for this accessory. It does not change where an app opens, and it does not release the accessory.

Only NFT media queries persist locally. Project app caches include the owner address. The NFT owner badge is informational.

## Code

| Path | Responsibility |
| --- | --- |
| `src/middleware.ts` | Same-origin API checks. Admit cookie for `/accessory` and `/accessory/link`. |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view and claim rules, load project apps. |
| `src/lib/shared/link-transaction.ts` | Transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Claim, release, Privy sign-in, and signing. |
| `src/lib/client/wallet/embed-host.ts`, `src/lib/shared/wallet-bridge.ts` | In-app browser and the wallet injected into it. |
| `src/app/ul/browse`, `src/lib/shared/browse-link.ts` | Stateless browse deeplinks into the in-app browser. |
| `src/lib/shared/wallet-{transfer,fee,holdings}.ts`, `src/lib/client/wallet/send.ts` | `/wallet`: balances and transfers. The connected wallet pays the fee. |
| `src/lib/components/app`, `src/app` | UI, including `/accessory/link` and `/wallet`. |

Never expose an RPC URL that contains a secret to the browser.
