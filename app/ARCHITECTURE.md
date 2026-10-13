# Revibase app architecture

See [README.md](README.md) for development, testing and deployment. The program and SDK define the protocol; the app adds session authorization and linking flows.

## Access and authority

| Entry | Grants |
| --- | --- |
| Signed NFC URL | Ten-minute `browse_unlock` session: inspect the accessory and open the link page. |
| Wallet sign-in | Thirty-day `owner_session` (`OWNER_SESSION_TTL_MS`); a current owner check issues a view-only `owner_browse` session. |
| Fresh WebAuthn assertion | Slot-bound approval for linking, completed with the recipient wallet signature. |
| Owner signature | Unlinking (rejected for Permanent tokens), sending from the accessory wallet and changing tap payments, without a physical tap. |

An unused signed NFC URL can remain valid until a newer counter is consumed; it does not prove current physical presence. A tap does not prove wallet-key control or NFT ownership. The accessory’s on-chain `owner`, the NFT holder and the physical holder can differ. Any mint-backed token type shows metadata and shortcuts. Bearer relinks while unlocked; Controlled must be unlinked first; Permanent cannot change its link. Server and UI use `accessoryRules`.

The URL’s `pk` is the chip identifier, not its WebAuthn passkey. Resolve it to the token, then derive its PDA from `public_key`; the immutable identifier→PDA mapping is cached in D1.

## Security invariants

- Verify signed tap URLs before atomically consuming the shared `tap_counters` high-water mark. Ignore speculative prefetch. Redirect to a clean URL with `no-store` and `no-referrer`.
- Accessory taps the server accepts (tap resume) must be signed on this origin: `verifyResponse` checks `clientDataJSON.origin` against the request URL’s origin, so another site can’t pass a challenge to a user and replay their tap here.
- Shared `auth_challenges` are single-use; consume them atomically. Session cookies are HMAC-signed, HttpOnly, Secure and SameSite=Lax (`__Host-` in production).
- `browse_unlock` opens the link page; `owner_browse` does not. Linking runs entirely in that page: the server keeps no link state.
- Linking uses SDK `beginTransfer` → `authenticatePasskeyForTransfer` → `completeTransfer`. The program checks the recent slot hash, token passkey, user-presence flag, increasing sign count, lock state and recipient signer.
- The transfer challenge names the recipient (`SHA256("transfer" ‖ token ‖ slot_hash ‖ recipient)`), so a tap can only make the wallet it was made for the owner. The page connects that wallet before the tap, shows it, and discards the tap if the wallet changes.
- Validate exact transaction bytes before and after signing. Preserve the approved programs, accounts, recipient, slot and assertion; reject unexpected signers or lookup tables.
- Linking does not enforce origin/rpId on-chain. A transfer assertion harvested on another site can still be used, but only for the recipient it names; chip identifier/passkey binding also depends on the issuer.
- JSON mutations require same-origin requests, except `/api/signer/*`, which accepts only the secure-signer origin (CORS, no cookies; each call authenticates itself).
- `/api/sponsor` is public (open CORS, no cookies). Its pool keys sign only as a fee payer (and `update_policy` payer) for one real phygital-token action on one accessory, within compute and priority caps, and only if a simulation shows the key losing no more than the fee and any tap-payments rent net of the refill. A pool key may appear nowhere else, except as the refill's destination.
- The passkey wallet's keys never reach this page: they are wrapped by the passkey's PRF inside the secure-signer iframe, which shows its own consent screen and signs only owner actions. See [secure-signer](../secure-signer/README.md).

## Linking and recovery

Phone only: wallet selection → accessory approval → wallet approval → confirmation, all on the link page (`src/lib/client/link/flow.ts`). Desktop visitors see “Open on your phone” with a QR code of the page (never its single-use tap parameters).

The owner's wallet is connected first, because the challenge names the new owner. The page then fetches the slot-bound challenge itself (`beginTransfer`) before the click, since iOS WebAuthn requires a user gesture without awaiting a network request, and refreshes it as it goes stale. After the tap, the countdown uses a conservative SlotHashes expiry estimate (`TAP_WINDOW_MS`); when it runs out the page returns to the tap step, and the program remains authoritative. That wallet then signs through the shared owner path (`submitAsOwner`), which checks the exact bytes, and the page waits for confirmation. A reload starts again from the tap.

Wallets are whatever `@solana/connector` detects (Wallet Standard, plus Mobile Wallet Adapter on Android) and the built-in “Revibase Passkey” wallet, which registers itself through Wallet Standard. There are no hardcoded wallet deeplinks.

## Network fees

Rate limiting for the fee service is managed in the Cloudflare dashboard. The app does not configure a rate-limit binding or implement request throttling.

Every transaction is paid, in order, by:
1. the owner's wallet, when it can afford it (one signer fewer, so cheaper);
2. otherwise the accessory's prepaid fees (0.005 SOL from Revibase, kept in D1 `revibase_sponsor_txs`), through a key from the `/api/sponsor` pool, which signs last as a Kit partial signer;
3. when those can't cover it, the same transaction refills them back to 0.005 SOL from the accessory wallet (an `execute_with_owner` / `execute_with_accessory` System transfer to the fee payer);
4. if the accessory wallet can't, the app asks for SOL in the accessory wallet.

The accessory wallet pays for token accounts it opens. Tap-payments rent is paid by whoever pays the fee and always returns to the accessory wallet when the account closes. Pending costs count against the balance at once; refills only once they land; transactions whose blockhash expires unlanded are dropped. Integrator taps (`getPhygitalWalletSigner`) check the balance on every sign and refill within their tap-payment limits; when the limits block it, the owner refills from the accessory wallet page. `NetworkFeeLine` shows the fee source where the approval flow requests it; custom-program change review suppresses that line.

The fee service doesn't need the owner's signature first: a transaction can't land without it, and an unsigned one only reserves its fee until its blockhash expires.

## Shortcuts and local state

Project `shortcuts.json` comes from the mint’s HTTPS `external_url`. Every HTTPS shortcut opens in a new browser tab. `revibase.launch` may be `browser` or `embed` (other values skip the shortcut); `embed` and Phantom `preferredPresentation: "immerse"` open in a tab like everything else. The integrator contract is documented on the Revibase developer site.

Shortcuts carry no session proofs or authentication credentials. Destinations handle their own sign-in and wallet connection.

Shortcut tiles link straight to the project's URL. The passkey signer is the only external iframe the app allows.

The browser remembers only the owner it last linked per accessory (to notice a change elsewhere) and the most recent wallet app (to list it first).

Only NFT media queries persist locally. Shortcut caches include the linked address; wallet-accessory lists revalidate and are invalidated after link/unlink. The NFT owner badge compares media ownership with the owner and is informational, not an authorization check.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/lib/server/tap`, `session` | Tap verification, replay counters, cookies. |
| `src/lib/server/accessory` | Resolve tokens, enforce view/link rules, load shortcuts. |
| `src/lib/server/signer` | Passkey-wallet backup API (encrypted blobs, WebAuthn and ed25519 proofs). |
| `src/lib/server/sponsor` | Fee service: pool keys, transaction checks (`inspect.ts`), prepaid-fee ledger. |
| `src/lib/shared/fee-payer.ts`, `src/lib/client/accessory-wallet/submit.ts` | Who pays each owner transaction, and building and signing it. |
| `src/lib/shared/link-transaction.ts` | SDK transaction construction and byte validation. |
| `src/lib/client/link`, `wallet` | The link flow, error copy, connector discovery and signing. |
| `src/lib/client/wallet/secure-signer` | “Revibase Passkey”: Wallet Standard wallet, iframe client and connect flow. |
| `src/lib/client/memory.ts`, `shortcuts.ts`, `queries.ts` | Local memory, shortcut launch and cache policy. |
| `src/lib/components/app`, `src/routes` | Shared UI and entry flows. |

Wallet Standard signs kit-8 transaction bytes directly because the connector uses kit 7. Discovery and MWA still use the connector. Never expose an RPC URL containing private credentials to the browser.

## Tap permissions and permission requests

`PolicySheet` owns the active policy and editable draft. The main pane edits the transaction toggle and spending caps. `ProgramsEditor` presents every program in one list, including the default payment programs, with distinct program, action-selection, restriction and change-review panes. There is one primary action per pane and one contextual Back/Keep editing control. See [wallet UX](../docs/wallet-ux.md) for the complete flow.

Selecting an instruction opens its restrictions directly. Restrictions are added explicitly; existing unsupported checks are preserved. IDL upload supplies display metadata and a pending program, never an empty active policy entry. Programs are unique by address, and a program has at most one action per instruction (no selector may repeat or prefix another, as the program enforces); imported permissions are validated before conversion into Maps.

Review changes stages the action and shows program-specific differences. `programSaveDraft` applies only that program against the active policy, preserving active limits and other programs. The shared owner commit path builds, signs and waits for confirmation before updating the active draft and showing Changes saved. Leaving modified work offers Keep editing or Discard. Main-pane Save applies the complete remaining draft; disabling closes the policy.

Reset to default actions restores the transfer-only preset while preserving spending limits. It is a draft change requiring main-pane Save. Import/Export live in the main pane's header menu; imports show a replacement preview before staging. Permission equality compares encoded rule semantics, so object ordering and omitted empty checks do not create false changes.

Native program IDLs are pinned official Codama snapshots, imported on demand and parsed once across editor mounts. Saved custom IDLs restore in one batch and remain display metadata, separate from authority. The guided editor sets restrictions by name; JSON import is the escape hatch for unsupported constraints.

Projects generate `/permissions#r=…` links using the SDK's `encodePermissionRequest`, or host JSON at an HTTPS URL referenced by `?src=…` (with CORS enabled). The payload contains no accessory identifier. The owner connects their wallet and chooses a linked accessory. Parsing rejects unknown fields, oversized input and invalid on-chain rules. Fragment payloads stay out of HTTP requests and are preserved in the desktop phone QR.

`mergeRequest` adds missing rules and raises caps without removing existing permissions. When reset periods differ it preserves the shorter recurring window; a recurring allowance also remains recurring when the request asks for a lifetime cap. These changes are explained explicitly. `policyDiff` builds only changed on-chain actions. Review waits for policy, asset metadata and balances; program upgradeability lookup failures appear as cautions. Unknown programs, upgradeable programs, destructive token operations, broad access and excessive long-term limits receive warnings. Danger needs a fresh acknowledgement before approval or entering the editor. The source hostname identifies where JSON was fetched, without endorsing the project.

The passkey signer independently derives program names, custom-rule details and risk warnings from decoded instructions using `secure-signer/shared`; it never trusts descriptions supplied by the app. Token burn, approval, authority and close-account permissions are detected even when the rule has additional constraints.

Owners can limit which sites may ask for a tap (`allowed_origins`, empty = any site). The program checks the tap's signed `clientDataJSON.origin`, which browsers set, so other websites can't use a tap; a native app talking to the accessory directly can still claim any origin, so spending limits remain the backstop. A permission request's `origins` are added only when the owner already limits sites. The field sits before the program permissions, so close devnet policies saved with an older layout before upgrading the program. Caller-selected origins in sign-in `verify` are separate.

## Touch controls and action hierarchy

Shared shadcn controls use a minimum 44 × 44 CSS-pixel target, adapting Apple HIG’s 44 × 44 pt guidance to this web app. Button sizes: `default` and `sm` are 44 px high (`sm` only tightens padding); `icon` is a 44 px round, muted icon button; `xl` is the 52 px, full-width primary action. Inputs and select triggers are 48 px high. Menu and dropdown triggers take their look from `buttonVariants`, so they match buttons.

Each pane has one emphasized primary action (`xl`); a second, equal choice uses `secondary` `xl`. Tertiary actions (Cancel, Back, Use a different wallet) use the `quiet` variant at full width. Deleting a program or action uses `destructive-quiet`; a filled destructive action uses `destructive`. Inline “Add …” actions use the `add` variant with a plus icon. Avoid size or colour overrides on buttons: add a variant instead. Checkbox glyphs stay 20 px inside a 44 px target, and disclosure triggers are at least 44 px high.

## Shared client and UI boundaries

`WalletConnect` is the one way to connect: a Connect wallet button and the picker sheet, with its own connecting and error state, remembering the recent wallet. Callers add `requireAddress` (owner only), `afterConnect` (e.g. the login signature) or `onconnected`. Disconnected transaction actions show Connect wallet and open it directly. A connected non-owner sees an owner-only explanation; signing remains checked against the current on-chain owner. Read-only wallet content and Receive remain available without connection. Individual sends use one form and submit directly to wallet approval; bulk sending retains selection and approval-count information.

Layout primitives in `src/lib/components/app`: `List`/`ListRow` for rows (with `value` for a trailing figure and `selectable` for checkbox rows), `Section` for labelled groups, `Panel` for the one muted surface, `Field`/`FieldError` for labelled controls and their errors, `Disclosure` for optional detail, `Notice` (with `error` for a `FriendlyError` and `onretry` for the standard Try again), `EmptyState`, `ListRowSkeleton`, `Loading` and `CopyField`. Every sheet is a `ResponsiveSheet` (a drawer on phones, nesting inside another sheet automatically).

Owner actions go through `confirmAsOwner` (submit, wait, then invalidate only that accessory's cached state); `savePolicy` and the send/release helpers build on it. Fee previews and the fee service's view of an accessory are shared queries (`feePreviewQuery`, `sponsorQuery`), so a screen computes each once. `clipboard.ts` centralizes copy success/error feedback. `api.ts` centralizes same-origin JSON requests and typed API failures; GET requests bypass browser caching. `QrCode` dynamically imports its renderer and ignores obsolete asynchronous results after a value change or unmount. `assetInfos` requests each missing mint once and validates token mint ownership and initialization before using decimals.
