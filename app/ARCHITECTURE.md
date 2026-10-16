# Revibase app architecture

See [README.md](README.md) for development, testing and deployment. The program and SDK define the protocol; the app adds session authorization and the claiming (linking) flows.

## Access and authority

| Entry | Grants |
| --- | --- |
| Signed NFC URL | Ten-minute `browse_unlock` session: inspect the accessory and start claiming it. |
| Wallet sign-in | Thirty-day `owner_session` (`OWNER_SESSION_TTL_MS`); a current owner check issues a view-only `owner_browse` session. |
| Fresh WebAuthn assertion | Slot-bound approval for claiming, completed with the recipient wallet's signature. |
| Owner signature | Releasing (`remove_owner`), without a physical tap; rejected for Permanent tokens. |

An unused signed NFC URL can remain valid until a newer counter is consumed; it does not prove current physical presence. A tap does not prove wallet-key control or NFT ownership. The accessory’s on-chain `owner`, the NFT holder and the physical holder can differ. Any mint-backed token type shows metadata and shortcuts. Bearer can be claimed again while unlocked; Controlled must be released first; Permanent cannot change owner. Server and UI use `accessoryRules`.

The URL’s `pk` is the chip identifier, not its WebAuthn passkey. Resolve it to the token, then derive its PDA from `public_key`; the immutable identifier→PDA mapping is cached in D1.

## Security invariants

- Verify signed tap URLs before atomically consuming the shared `tap_counters` high-water mark. Ignore speculative prefetch. Redirect to a clean URL with `no-store` and `no-referrer`.
- Accessory taps accepted by the server for resume must be signed on this origin for this rpId: `verifyResponse` checks `clientDataJSON.origin` against the request URL’s origin. The browser builds the claim challenge and submits the verified transaction directly to Solana RPC.
- Shared `auth_challenges` are single-use; consume them atomically. Session cookies are HMAC-signed, HttpOnly, Secure and SameSite=Lax (`__Host-` in production).
- `browse_unlock` permits claiming; `owner_browse` does not. The claim page requires the fresh tap session before reading the accessory.
- Claiming uses SDK `beginTransfer` → `authenticatePasskeyForTransfer` → `completeTransfer`. The program checks the recent slot hash, token passkey, user-presence flag, increasing sign count, lock state and recipient signer.
- The transfer challenge does not name a recipient (`SHA256("transfer" ‖ token ‖ slot_hash)`); the connected wallet supplies the recipient when it builds the transaction. The assertion stays in browser memory and is never sent to an app API.
- Validate exact transaction bytes before and after signing. Preserve the approved programs, accounts, recipient, slot and assertion; reject unexpected signers or lookup tables.
- Claiming does not enforce origin/rpId on-chain; the app checks both before it stores a tap. Chip identifier/passkey binding also depends on the issuer.
- Stateful app APIs require same-origin requests. Claim transaction construction, wallet signing and submission use the browser's configured Solana RPC directly.

## Claiming and recovery

Accessory approval → connector wallet selection when needed → wallet signature → confirmation. No link-intent API, pairing session or handoff capability is involved.

Prepare challenges before a click: iOS WebAuthn requires a user gesture without awaiting a network request. The countdown uses a conservative SlotHashes expiry estimate (`TAP_WINDOW_MS`); the program remains authoritative. If the assertion expires or the page reloads, the user taps again.

Link transactions are v0 with explicit compute-budget instructions. Wallet discovery and signing use `@solana/connector`, including MWA.

## Shortcuts and local state

Project `shortcuts.json` comes from the mint’s HTTPS `external_url`. `revibase.launch` may be `wallet` (open inside a wallet app's browser), `browser` (a plain tab) or `embed` (treated like `wallet`; nothing is framed). Legacy Phantom fields remain compatible. The integrator contract is documented on the Revibase developer site.

Shortcuts carry no session proofs or authentication credentials. Destinations handle their own sign-in and wallet connection. On a phone, a wallet shortcut opens in the wallet app this accessory was claimed with (or the most recent one), or asks which to use; inside a wallet browser it stays in place.

Wallet app preferences and claim provenance are browser-local and accessory/address-bound. Changed ownership removes stale hints. “Forget wallet preference” clears only that accessory’s app/context hints and requires selection until a new choice is saved; it does not release the accessory or affect other accessories. Releasing from a phone hands off to `/unlink/[pda]` in the owner's wallet app when that wallet isn't connected here.

Only NFT media queries persist locally. Shortcut caches include the owner's address; wallet-accessory lists revalidate and are invalidated after claim/release. The NFT owner badge compares media ownership with the owner and is informational, not an authorization check.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view/claim rules, load shortcuts. |
| `src/lib/shared/link-transaction.ts` | SDK transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Direct claim preparation, approval, error copy, connector discovery and signing. |
| `src/lib/client/memory.ts`, `shortcuts.ts`, `queries.ts` | Local preferences, launch routing and cache policy. |
| `src/lib/components/app`, `src/routes` | Shared UI and entry flows (`/accessory/link`, `/unlink/[pda]`). |

Wallet Standard signs kit-8 transaction bytes directly because the connector uses kit 7. Discovery and MWA still use the connector. Never expose an RPC URL containing private credentials to the browser.

## Touch controls and action hierarchy

Shared shadcn controls use a minimum 44 × 44 CSS-pixel target, adapting Apple HIG’s 44 × 44 pt guidance to this web app. Button sizes: `default` and `sm` are 44 px high (`sm` only tightens padding); `icon` is a 44 px round, muted icon button; `xl` is the 52 px, full-width primary action. Menu and dropdown triggers take their look from `buttonVariants`, so they match buttons.

Each pane has one emphasized primary action (`xl`); a second, equal choice uses `secondary` `xl`. Tertiary actions (Cancel, Back, Use a different wallet) use the `quiet` variant at full width. A filled destructive action uses `destructive`. Avoid size or colour overrides on buttons: add a variant instead.

## Shared client and UI boundaries

`WalletConnect` is a Connect wallet button and the picker sheet, with its own connecting and error state, remembering the recent wallet. Claim and release use `WalletPicker` directly and connect to detected wallet-standard connectors.

Layout primitives in `src/lib/components/app`: `List`/`ListRow` for rows, `Section` for labelled groups, `Panel` for the one muted surface, `Notice` (with `error` for a `FriendlyError` and `onretry` for the standard Try again), `EmptyState` and `ListRowSkeleton`. Every sheet is a `ResponsiveSheet` (a drawer on phones, nesting inside another sheet automatically).

`clipboard.ts` centralizes copy success/error feedback. `api.ts` centralizes same-origin JSON requests and typed API failures; GET requests bypass browser caching. `QrCode` dynamically imports its renderer and ignores obsolete asynchronous results after a value change or unmount.
