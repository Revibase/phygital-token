# Revibase app architecture

See [README.md](README.md) for development, testing and deployment. The program and SDK define the protocol; the app adds session authorization and linking flows.

## Access and authority

| Entry | Grants |
| --- | --- |
| Signed NFC URL | Ten-minute `browse_unlock` session: inspect the accessory and start linking. |
| Wallet sign-in | Twelve-hour `owner_session`; a current owner check issues a view-only `owner_browse` session. |
| Fresh WebAuthn assertion | Slot-bound approval for linking, completed with the recipient wallet signature. |
| Owner signature | Unlinking, without a physical tap; rejected for Permanent tokens. |

An unused signed NFC URL can remain valid until a newer counter is consumed; it does not prove current physical presence. A tap does not prove wallet-key control or NFT ownership. The accessory’s on-chain `owner`, the NFT holder and the physical holder can differ. Any mint-backed token type shows metadata and shortcuts. Bearer relinks while unlocked; Controlled must be unlinked first; Permanent cannot change its link. Server and UI use `accessoryRules`.

The URL’s `pk` is the chip identifier, not its WebAuthn passkey. Resolve it to the token, then derive its PDA from `public_key`; the immutable identifier→PDA mapping is cached in D1.

## Security invariants

- Verify signed tap URLs before atomically consuming the shared `tap_counters` high-water mark. Ignore speculative prefetch. Redirect to a clean URL with `no-store` and `no-referrer`.
- Shared `auth_challenges` are single-use; consume them atomically. Session cookies are HMAC-signed, HttpOnly, Secure and SameSite=Lax (`__Host-` in production).
- `browse_unlock` permits linking; `owner_browse` does not. Authorize every ceremony API against its originating session or claimed finisher.
- Handoff/pairing capabilities are random, single-use and fragment-only. Store only their hashes; exchange for a finisher cookie and scrub the fragment. An undetected wallet must not consume its capability.
- Linking uses SDK `beginTransfer` → `authenticatePasskeyForTransfer` → `completeTransfer`. The program checks the recent slot hash, token passkey, user-presence flag, increasing sign count, lock state and recipient signer.
- The transfer challenge does not bind a recipient: the authorized finisher chooses it. Show that recipient on the originating page and permit cancellation before submission.
- Validate exact transaction bytes before and after signing. Preserve the approved programs, accounts, recipient, slot and assertion; reject unexpected signers or lookup tables.
- Linking does not enforce origin/rpId on-chain. A transfer assertion harvested on another site remains a protocol risk; chip identifier/passkey binding also depends on the issuer.
- JSON mutations require same-origin requests. Wallet handoffs use fixed templates around app-created URLs, never arbitrary return URLs.

## Linking and recovery

Phone: accessory approval → wallet selection/handoff → wallet approval → confirmation.
Desktop: phone pairing → accessory tap and matching-code confirmation → wallet approval → confirmation.

D1 `revibase_link_intents` uses compare-and-set transitions. New ceremonies cancel previous ones for the accessory. Terminal states remove stored assertions. Expired slot windows return to the tap step while keeping the finisher.

Prepare challenges before a click: iOS WebAuthn requires a user gesture without awaiting a network request. The countdown uses a conservative stored SlotHashes expiry estimate; the program remains authoritative. Reloads resume by intent ID plus the finisher cookie; origins refresh status on visibility return.

Detected connectors, including MWA, record browser connections. Hardcoded Phantom/Backpack/Solflare browse choices record wallet-app handoffs. A browse link cannot select an account or share another browser’s wallet connection.

## Shortcuts and local state

Project `shortcuts.json` comes from the mint’s HTTPS `external_url`. `revibase.launch` selects embed, wallet or browser behavior; legacy Phantom fields remain compatible. See the [integrator contract](../../developer/content/docs/cards/landing-page.md).

Each HTTPS shortcut receives a fresh Ed25519 `revibase_session` proof, including third-party destinations selected by the project. Its audience is the destination origin, expiry is at most five minutes, and `jti` must be consumed once by the integrator. A proof is accessory access context, not transaction signing authority.

Embedding requires successful framing checks. Keep the host and exit controls outside the sandboxed iframe; allow only its origin in that page’s `frame-src`, with no top navigation or authenticator delegation. Navigation back performs a full load to reset page-specific CSP.

Wallet app preferences and link provenance are browser-local and accessory/address-bound. Changed linkage removes stale hints. “Forget owner details” clears only that accessory’s app/context hints and requires selection until a new choice is saved; it does not unlink or affect other accessories. Recognized wallet browsers stay in place.

Only NFT media queries persist locally. Shortcut caches include the linked address; wallet-accessory lists revalidate and are invalidated after link/unlink. The NFT owner badge compares media ownership with the owner and is informational, not an authorization check.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies and shortcut proofs. |
| `src/lib/server/accessory` | Resolve tokens, enforce view/link rules, load shortcuts. |
| `src/lib/server/link` | Ceremony authorization, state transitions, slot windows and confirmation. |
| `src/lib/shared/link-transaction.ts` | SDK transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | Polling, approvals, connector discovery and signing. |
| `src/lib/client/memory.ts`, `shortcuts.ts`, `queries.ts` | Local preferences, launch routing and cache policy. |
| `src/lib/components/app`, `src/routes` | Shared UI and entry flows. |

Wallet Standard signs kit-8 transaction bytes directly because the connector uses kit 7. Discovery and MWA still use the connector. Never expose an RPC URL containing private credentials to the browser.
