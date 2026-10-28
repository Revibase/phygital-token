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

## Project page

The project's part of the tap page comes from `revibase.json` at the mint’s HTTPS `external_url`: its `apps`, a `style` (`accent`, `background`) and `featured` entries keyed by audience. It is Revibase’s own format, not Phantom’s `shortcuts.json`, so a project can serve both without one affecting the other. Only `"version": 1` is read; `style` and `featured` are optional additions to it, so older files show only their apps.

The page has one image and one button:

- **Image.** `pickFeatured` takes the viewer’s entry (`unclaimed`, `owner` when the connected wallet owns it, `visitor`), else `default`. Its image tops the page with the accessory mark and verified check over its lower edge; without one, the NFT art. Title and text sit under the NFT name; owner, management and technical details are behind one Details link.
- **Button.** `mainButton` picks it, pinned at the bottom on phones: Claim whenever the viewer can claim, otherwise the entry’s `button` (an app named by its label), otherwise none. Built-in flows are never in the file; Revibase adds them. Release and change owner stay behind Details. Every app stays in the apps row, the button’s too: the row is the full list, the button a shortcut to one of them.
- **Background.** `ProjectSurface` paints it behind the page. A color fills as is and picks Revibase’s light or dark text palette by contrast. An image is blurred and darkened under the dark palette. Sheets and the in-app browser render outside it, unthemed.

The file is untrusted data, and the page is built so that it stays data:

- **Nothing executes.** No HTML, Markdown, CSS or SVG. Text renders as React text nodes, colors must match `#RRGGBB`, and they reach the page only through React `style` objects.
- **Revibase keeps the trust chrome.** The header, the verified check, the Genuine eyebrow, the NFT name, the owner line, Claim, the in-app browser chrome and wallet prompts are never recolored by the project; on a background they only switch between Revibase’s own light and dark palettes. The NFT art was always the project’s, so position isn’t the boundary; what Revibase writes and renders is. A background image is blurred so it can’t carry a sharp fake control.
- **The button is an app.** It names an entry in `apps`, so it passed the same URL checks, and its host shows under it. A label that reads like a Revibase flow or wallet prompt (claim, release, verify, connect, sign, wallet, …) shows as “Open”. Claim keeps Revibase’s colors; the accent only fills the project’s own button and icon-less tiles.
- **Only the Worker talks to the project.** The file, icons, featured images and the background image are fetched server side; images come back as HMAC-signed, raster-only proxy paths (`/app-icon`, `/asset-image`). The tapper’s IP never reaches the project.
- **No automatic actions, and audiences are cosmetic.** The file is public, so a project must gate real perks on its own server.

| `open` | Opens |
| --- | --- |
| `embed` | In-app browser, and only when the link is the project host or a subdomain |
| `tab` | New tab, any HTTPS host |

An app link carries no session or key material. The frame can ask the shell to connect and sign. The shell approves connect once per origin and account, then the connected wallet signs. A dApp registers that wallet with `registerIframeWallet({ parent: "https://portal.revibase.com" })` before it starts a connector. Registration happens only inside an iframe whose parent sent hello. A normal visit is unchanged.

Any app can send someone into the Revibase wallet with a browse link in the same schema as Phantom, Solflare and Backpack: `/ul/browse/<url-encoded page URL>?ref=<url-encoded origin>`. The link is stateless: `/ul/browse` checks only that the page is http(s) and opens it in the in-app browser, fragment included. `ref` is accepted for compatibility and ignored, since anyone writing the link can put any origin there; the page is labelled by its own hostname. Connecting from that page asks the person the first time, like any other site, and they still approve every transaction.

“Forget wallet preference” clears the claim details shown for this accessory. It does not change where an app opens, and it does not release the accessory.

Only NFT media queries persist locally. Project page caches include the owner address. The NFT owner badge is informational.

## Code

| Path | Responsibility |
| --- | --- |
| `src/middleware.ts` | Same-origin API checks. Admit cookie for `/accessory` and `/accessory/link`. |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view and claim rules, load the project page. |
| `src/lib/shared/link-transaction.ts` | Transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Claim, release, Privy sign-in, and signing. |
| `src/lib/client/wallet/embed-host.ts`, `src/lib/shared/wallet-bridge.ts` | In-app browser and the wallet injected into it. |
| `src/app/ul/browse`, `src/lib/shared/browse-link.ts` | Stateless browse deeplinks into the in-app browser. |
| `src/lib/shared/wallet-{transfer,fee,holdings}.ts`, `src/lib/client/wallet/send.ts` | `/wallet`: balances and transfers. The connected wallet pays the fee. |
| `src/lib/components/app`, `src/app` | UI, including `/accessory/link` and `/wallet`. |

Never expose an RPC URL that contains a secret to the browser.
