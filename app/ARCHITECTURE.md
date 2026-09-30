# Revibase accessory app — architecture

> Tap your accessory. Your identity comes with you.

This app lets someone link (delegate) a Solana wallet to a physical NFC accessory through the program's `set_linked_wallet` instruction. After that, the accessory can prove who the user is, as that wallet, with a single tap. The accessory never holds the wallet's key.

The program (`programs/phygital-token`) and the SDK (`packages/js/phygital-token`) are the source of truth. This document records what the app relies on, where each check runs, and why.

---

## 1. Protocol model

### Accounts

| Account | Fields used by the app |
|---|---|
| `PhygitalToken` (144 B, PDA `["token", public_key[1..]]`) | `linked_wallet`, `mint`, `last_sign_count`, `token_type` (0 Permanent · 1 Bearer · 2 Controlled), `is_locked`, `public_key` (FIDO passkey, 33 B), `identifier` (NDEF chip key, 33 B) |
| `AdminConfig` (`["admin"]`) | Not used by the app. Only the issuer creates tokens and only the minter binds `mint`. |

The NFC dynamic URL's `pk` is the **`identifier`**, not the passkey. The SDK's `fetchPhygitalTokenByIdentifier` scans for it with `getProgramAccounts` and returns the account *without* its address, so the PDA is derived with `findPhygitalTokenPda(account.publicKey)`. The app caches identifier → PDA in D1; both are immutable after `initialize`.

### `set_linked_wallet`

- **Accounts:** `recipient` (signer), `phygital_token` (writable), the SlotHashes sysvar, and the Instructions sysvar.
- **Arguments:** `Secp256r1VerifyArgs { verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }` and `slot_number`.
- **It requires:**
  - `is_locked == 0`;
  - a WebAuthn challenge equal to `SHA256("transfer" ‖ pda ‖ slot_hash)`, where `slot_hash` must still be in SlotHashes;
  - an immediately preceding `secp256r1` precompile instruction whose key is `token.public_key`;
  - the UP flag set;
  - `signCount > last_sign_count`.
- **It then** sets `linked_wallet = recipient`. A Controlled token re-locks.
- **It does not check rpId or origin.**
- **The recipient is not part of the challenge.** This is deliberate: the user taps first, and the wallet that finishes decides the recipient (see §3).

SDK path: `beginTransfer` → `authenticatePasskeyForTransfer` → `completeTransfer`, which returns `[secp256r1_verify, set_linked_wallet]`. The app never rebuilds these instructions by hand.

### `remove_linked_wallet`

- Signed by the current `linked_wallet`. **No tap is needed.**
- Resets the wallet to unset and unlocks the token.
- Rejected for Permanent tokens.

### What each token type allows (enforced in `accessoryRules`)

| Type | Meant for | Link | Release |
|---|---|---|---|
| **Bearer** | Tradable collectibles (e.g. NFC trading cards) | While unlocked. A tap can move it to a new wallet. | By the linked wallet |
| **Controlled** | Personal keys | **Only when no wallet is linked.** Once linked, it must be released first. | By the linked wallet |
| **Permanent** | Personal keys | Never. Fixed forever from `initialize`. | Never |

The screens and copy follow the same split: `tapScreen` and `linkCopy` (`src/lib/client/accessory/`) word a Bearer accessory as a collectible ("Claim it", "In your collection") and the others as keys ("Link wallet", "Authenticates as your wallet"). A ceremony records the accessory's `token_kind` when it joins, so the wallet app and the computer can use the right wording without an RPC per poll.

These rules sit on top of the on-chain lock flag. The app never presents an unexpected on-chain combination as linkable, and the server enforces the same rules when starting a ceremony, attaching a desktop pairing, and accepting a tap.

---

## 2. Trust boundaries

| Operation | Runs in |
|---|---|
| Parse and verify the dynamic-URL signature, consume the tap counter, resolve the token, issue browse_unlock | **Backend** (Worker plus D1) |
| Ceremony state machine, custody of the tap, on-chain confirmation | **Backend** |
| FIDO assertion over the slot-bound challenge | **Accessory authenticator**, via WebAuthn in the phone's browser |
| Choosing the recipient (the connected account) and signing | **Wallet** (Wallet Standard via `@solana/connector`, or MWA on Android) |
| Re-validating the exact transaction bytes before and after signing | **Client**, in the wallet context |
| Signature, challenge, `signCount`, lock, recipient signer | **Solana program**, the final authority |

### What a tap proves

- An NFC dynamic-URL tap (`pk`, `c`, `n`, `s`) proves the chip's identifier key signed `counter ‖ nonce` at some point after the last accepted counter.
- It does **not** prove the accessory is present *now*: a skimmed, photographed or unsubmitted URL stays valid until a newer tap is consumed.
- It also does not prove who is holding the accessory, or who owns any wallet.
- So the browse_unlock session it creates grants **reading plus the right to start a ceremony**, and nothing else. Owner_browse grants reading only.
- Every state change needs either a fresh FIDO assertion over a recent slot hash, or the linked wallet's own signature.

### Tap counter (anti-replay)

- **Database:** the app uses a single D1 database, the shared `phygital-token` one.
  - `tap_counters` and `auth_challenges` are owned by phygital-wallet. Resume and owner-login challenges go in `auth_challenges` under their own namespaces and are consumed atomically with `DELETE … RETURNING`.
  - The app's own tables are prefixed `revibase_`.
- The high-water mark lives in the shared `tap_counters` table, so every service that accepts these URLs shares one mark per chip.
- If each service kept its own mark, a URL already used in one could be replayed in another.
- The consume step is a single conditional upsert (`… WHERE c < excluded.c`). The identifier is canonicalised to unpadded base64url exactly as phygital-wallet does.
- Signature verification happens first, so garbage can't burn a chip's counter.

### Sessions and URLs

Admit cookies (same model as phygital-wallet's browse_unlock | authority_browse):

| Cookie | Purpose | Issued by | Opens |
|---|---|---|---|
| `__Host-bu` (`bu`) | **browse_unlock** — physical possession | NFC tap (`/accessory?pk&c&n&s`) or WebAuthn Hold (`POST /api/tap/resume`) | `/accessory` (view) and `/accessory/link` (ceremony) |
| `__Host-os` (`os`) | **owner_session** — this browser proved control of a wallet (12 h) | `POST /api/owner/session` after one `solana:signMessage`; cleared by `DELETE` when the wallet disconnects | nothing by itself; mints `ob` |
| `__Host-ob` (`ob`) | **owner_browse** — the logged-in wallet owns this accessory | `POST /api/accessory/owner-browse {pda, address}`: needs `os` for that wallet and the chain's `linked_wallet` to match; no signature | `/accessory` (view only) |

`readAdmitSession` prefers browse_unlock when both somehow remain. Issuing either clears the other. Ceremony finishers (`hof`, `dsk`, `pair`) are unchanged.

- `GET /accessory?pk&c&n&s`:
  - prefetch requests (`Sec-Purpose` / `Purpose`) are ignored;
  - the tap is verified and its counter consumed;
  - `__Host-bu` is set (HMAC-signed, HttpOnly, Secure, SameSite=Lax, 10 minutes) and any leftover `__Host-ob` is cleared;
  - the response is a **303 to `/accessory`**, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

  The raw signed URL is never rendered and never kept as a history entry.
- **`/tap/expired`:** **Continue** runs `startAuthentication(message, { rpc })` → `POST /api/tap/resume` (`verifyResponse`) → reissues browse_unlock.
- **Home → open accessory:** connecting a wallet signs one challenge → `os`. Opening an accessory then needs no signature: `os` plus a chain check of `linked_wallet` issues `ob` → `/accessory`. If `os` is missing or belongs to another wallet the server answers 401 `unauthenticated`, and the client logs in again and retries.
- **Opening the same URL twice** in the same browser continues silently. Anywhere else it shows "That tap was already used". When taps arrive out of order, the newest wins.
- **Capabilities** (`h` for a wallet app, `p` for desktop pairing) are 256-bit, single-use, and travel **only in URL fragments**, so they never reach server logs or a Referer header.
  - The server stores only their SHA-256.
  - On first load the page claims one for an HttpOnly finisher cookie, then scrubs it from the address bar.
  - A second claim fails and raises an alarm on the other screen.
- **No endpoint takes a redirect or return URL.** Wallet deep links are fixed templates, and they only ever wrap a same-origin URL that we built.

### Wallet discovery

- **Wallets come from `@solana/connector` auto-detection:** Wallet Standard injection, extensions, and Mobile Wallet Adapter on Android. Phantom, Backpack and Solflare are featured first.
- **On phones, any of those three that isn't detected gets an "Open in …" option.** It uses the wallet's documented browse deep link to reopen the page inside that wallet's in-app browser:
  - `phantom.app/ul/browse/…`
  - `backpack.app/ul/v1/browse/…`
  - `solflare.com/ul/v1/browse/…`
- Where this applies:
  - after the tap, the target is the `/continue#h=…` link;
  - for release and the wallet home, it is `/`;
  - the desktop flow never shows deep links.
- **`/continue` claims `h` only once a wallet is detected.** Opened somewhere without one, such as Safari, the link stays unclaimed and is offered for reopening in a wallet app. A browser with no wallet can't burn the single-use link.
- `catalog.ts` holds the logic and `WalletPicker` renders it everywhere.
- **Recent wallet:** the finisher sends its wallet app's name with `POST …/submitted` (stored as `wallet_app`, surfaced in the status view). When the tapping browser sees `linked` it remembers that name locally, and connecting a wallet on Home does the same. `WalletPicker` lists the recent app first with a "Recent" tag, including the "Open in …" rows, which is what the tapping browser (usually Safari, with no wallet detected) shows.
- CSP (`script-src 'self'` plus nonces, `frame-ancestors 'none'`; `frame-src` only on an embedded-app page, for that app's one origin), same-origin `Origin` checks on every JSON POST. `SOLANA_RPC_URL` is itself a public proxy Worker with no secret in it, so the browser calls it directly (reads, DAS and sending); the CSP `connect-src` allows `https:` for it.

---

## 3. The linking ceremony

A tap must come before the wallet signature, because the wallet signs bytes that include the tap. The recipient-free challenge lets the tap happen before we know which wallet will finish, so the phone only needs to be able to do WebAuthn and the wallet can be anywhere.

The tap is a short-lived bearer capability: whoever redeems it first chooses the recipient. The app therefore treats it as a secret:
- it stays in **server custody**;
- it is released exactly once, to a single **finisher session**;
- it dies when it lands, since `signCount` makes it stale, or when its slot hash leaves SlotHashes.

### Phone → wallet app (default)

```
Safari/Chrome (tap origin)          Server (Worker + D1)                    Wallet in-app browser
──────────────────────────          ────────────────────                    ─────────────────────
NFC tap ──GET /accessory?pk&c&n&s─▶ verify P-256 · consume counter
                                    resolve token · __Host-bu · 303
"Link wallet" ─POST /api/link─────▶ intent: created (1 per accessory) +
                                    SDK beginTransfer(rpId) → slot, hash,
                                    challenge stored → awaiting_passkey
(refresh only) ─POST …/challenge──▶ new slot-bound challenge
"Tap to approve" (user gesture)
 SDK authenticatePasskeyForTransfer
 ─POST …/assertion {response}─────▶ challenge ·
                                    P-256 sig ·
                                    type rules
                                    → tapped; tap kept in custody
◀── handoffUrl = /continue#h=… ──── mint h (single-use, dies with the tap)
"Open in Phantom/Solflare" ──────────────────────────────────────────────▶ /continue#h=…
                                    ◀──────────── POST /api/handoff/claim ─ read h, scrub URL
                                    claimed; __Host-hof = the finisher ───▶
                                                                            connect wallet (connector)
                                    ◀──────── POST …/recipient {address} ─
                                    finishing; release payload to hof only ▶
                                                                            SDK completeTransfer(W)
                                                                            validate bytes → wallet signs
                                                                            re-validate → sendTransaction
                                    ◀──────────── POST …/submitted {sig} ──
                                    confirm: status + linked_wallet == W
polls: "Linking to 7xKp…" → linked ◀──────────── linked ──────────────────▶ "Linked"
```

### Same browser (⎘)

If the tapping browser also has a wallet (Android MWA, or a desktop extension), it claims its own `h` and finishes in the same tab.

### Desktop shows a QR, phone scans it

1. **Desktop, home page (`/`):** with the extension wallet connected, choose **Link an accessory**. A sheet opens and calls `POST /api/pair`. This creates an intent in state `pairing`, binds the finisher cookie `__Host-dsk` up front, and shows a QR for `/pair#p=…` (5 minutes).
2. **Phone scans:** it claims `p` and gets `__Host-pair`; the state becomes `paired`. A second scan fails and alarms the desktop.
3. **Accessory tap on the phone** (either order): the tap handler attaches that accessory to the intent (`accessory_attached`).
4. **Both screens show the accessory and a 4-character code**, `HMAC(secret, linkId ‖ pda)`. The desktop must **confirm the accessory** before anything else happens. Linking your wallet to someone else's accessory would hand them your identity.
5. **The phone does the approval tap.** The desktop, as the pre-bound finisher, receives the payload, validates, signs and submits.

### State machine (D1 `revibase_link_intents`, compare-and-set transitions)

- Phone: `created → awaiting_passkey → tapped → [claimed] → finishing → submitted → linked`
- Desktop: `pairing → paired → accessory_attached → accessory_confirmed → awaiting_passkey → tapped → finishing → submitted → linked`
- Terminal states: `cancelled | expired | failed`. The stored tap is deleted on entering any terminal state.
- Starting a new ceremony for an accessory cancels the old one.

### Tap window (the countdown)

- `set_linked_wallet` looks the tap's slot up in SlotHashes when it executes.
- The slot hash is fetched **once per challenge**, at issue time. The server then stores `slot_expires_at = fetchedAt + (511 − 20) × 200 ms`: the hash survives 511 more blocks, minus **20 blocks** so a signature made at the last second can still land.
- **Nothing reads the SlotHashes sysvar after that.** Status polls, the assertion, the recipient step and the handoff compare `Date.now()` with the stored expiry. The estimate is conservative (real slots are slower than 200 ms and skipped slots don't use up entries), and it only drives the countdown. The program is the final authority.
- The tapping page fetches a challenge only when a tap is due and refreshes it once, after 45 s. It doesn't poll. iOS only allows WebAuthn inside a user gesture, so the hash has to be fetched before the click.
- When the window closes, the ceremony returns to "tap again" and keeps its finisher, so the wallet side just waits for the new tap.

### Threats → defenses

| Threat | Defense |
|---|---|
| Replayed, stale or copied tap URL | Shared counter high-water mark; the tap session is read-only; changes need a fresh FIDO tap |
| Session hijacking | `__Host-` HttpOnly Secure SameSite cookies with HMAC and short TTLs; ceremonies bound to the session id; payload only to the one finisher |
| Wallet substitution / wrong wallet | By design, the finisher picks the recipient. `h` is minted only after the tap, single-use, fragment-only and dies with the tap. The recipient is shown live on the phone, which can cancel before submission. |
| Accessory substitution | The program requires the tap's passkey to equal the token's `public_key`; the server doesn't check it at the assertion step, so a wrong accessory fails when the wallet sends. Desktop requires explicit accessory confirmation with a matching code. |
| Transaction substitution | Client byte-level validation before and after the wallet signs (programs, accounts, PDA, recipient, slot, tap data, secp key, single signer, no lookup tables) |
| Assertion made on another site | Neither the server nor the program checks origin or rpId. **Residual:** so a phishing site can harvest a transfer tap for an unlocked token and use it directly on-chain. Proposed follow-up: an `expected_origins` allow-list on `set_linked_wallet`. It keeps tap-first handoff intact, because the origin is the tap page. |
| Malicious deep links / redirects | No redirect parameters; fixed wallet templates; secrets only in fragments |
| Session proof replayed or leaked from a shortcut URL | Separate signing key (never valid as a cookie); `aud` bound to one shortcut origin; 5-minute expiry within the viewer's session; unique `jti` for projects to reject replays; only sent to the project's own host |
| Embedded app phishing under our page | Opt-in by the project and by its own framing headers; our bar sits outside the frame with the app's host and close/open buttons; sandbox without top navigation; no passkey, camera, mic or location delegation; `frame-src` for that one origin on that one page |
| Clickjacking / CSRF | `frame-ancestors 'none'`; same-origin `Origin` check on JSON POSTs |

---

## 4. Product surface

The app does one job: make the object stand in for your wallet.

| Route | Purpose |
|---|---|
| `/` | Two jobs. With tap parameters, the server load runs the tap ceremony and redirects to `/accessory`, so people holding an accessory never see this page. Without them, it's **Your accessories**: connect your wallet (one signature), open any accessory via owner_browse, and release any of them without the accessory. |
| `/tap/[reason]` | malformed · invalid · replayed · unknown · network · expired. Expired offers **Continue** (WebAuthn Hold → browse_unlock). |
| `/accessory` | Gated by browse_unlock **or** owner_browse. Ready to link · ready to use · locked (Controlled) · permanently yours · linked to a different wallet than this device last saw |
| `/accessory/link` | Needs browse_unlock. Two steps: **Tap to approve** → **Finish in your wallet** (a detected wallet here, open in Phantom/Backpack/Solflare, copy link, or use a computer) |
| `/continue` | Wallet side: connect → "Link this wallet" → approve |
| `/pair` | Phone side of desktop QR pairing. The computer side is the **Link an accessory** sheet on `/`, shown only on computers once a wallet is connected. |

Each secondary feature exists for the core idea:
- **Release** (shown as "Unlink" in the UI) handles revocation and handing the accessory to someone else. It's required for Controlled tokens.
- **The home page (`/`)** is the answer to a lost accessory: the linked wallet can release it there.
- **Technical details** are there for crypto-native users.

**Project shortcuts.** A collectible's project decides what its accessory's page offers beyond claiming, using [Phantom's Shortcuts spec](https://github.com/phantom/shortcuts) read as-is. A file written for Phantom works here unchanged, and there are no Revibase-only fields.
- **Discovery:** the Worker reads the mint's `external_url` from DAS and fetches `<external_url>/shortcuts.json` (`GET /api/accessory/shortcuts`, gated by the same admit session as `/accessory`).
  - It fetches server-side because most project hosts send no CORS headers, and so the project never sees the tapper's IP.
  - The fetch has a 3 s timeout, a 64 KB cap and a 10-minute edge cache. Any failure on the project's side means no shortcuts.
  - Every mint with an https `external_url` qualifies: projects are vetted before their accessories are printed.
- **Fields honoured:** `label` (clipped to 32), `uri`, `icon` (one of Phantom's 19 names, drawn to match Phantom's reference icons on a coloured tile; or an https image link, see below), `platform`, `limitToCollections`, `type` (only `collectible`), and `prefersExternalTarget`. At most 8 shortcuts are shown.
- **Placeholders:** `{{tokenId}}` is the mint, `{{collectionId}}` the DAS collection, and `{{ownerAddress}}` the on-chain `linked_wallet`, not the viewer's wallet.
  - A shortcut whose placeholder has no value is dropped. This includes `{{ownerAddress}}` on an unclaimed accessory.
  - Values must be base58 addresses, so a substituted value can never change a link's host.
- **Opening (`prefersExternalTarget: false`, Phantom's default):** the link must stay on the `external_url` host or a subdomain of it, which is Phantom's rule. Like Phantom's in-app browser, it opens inside a wallet:
  - on a computer, in a new tab, where the extension is;
  - inside a wallet browser, in place;
  - in a phone browser, through the recent wallet's browse deep link, or a sheet offering Phantom, Backpack and Solflare.
- **Opening (`prefersExternalTarget: true`):** a plain link to anywhere, or a `solana:` Solana Pay URI. Only `https:` and (external only) `solana:` are accepted.
- **Image icons:** an https link in `icon` fills the whole tile. The Worker serves it from `/shortcut-icon?u=…&s=…`, so the project never sees who's looking.
  - `s` is an HMAC of the URL under `SESSION_SECRET`, with its own context string, so the Worker only fetches icons named in a project's file. It's not an open proxy.
  - Only PNG, JPEG, GIF, WebP and AVIF are served, recognised by file signature and served as that type, with a size cap of 128 KB. SVG is refused: it's a document that can carry scripts and it would be served from this origin. Responses carry `default-src 'none'; sandbox` and are cached for a day.
  - A failed image falls back to the `generic-link` glyph.
- **Layout:** an app grid titled "From {collection}": four icon tiles to a row, each with its label beneath, in the file's order, which is the project's only layout lever. Each tile's tooltip names its destination host. The grid never takes over the page's own actions: "Make it yours" (while claimable), and the owner's Move, Unlink and Details.
- **Same for everyone:** the list is identical whether the viewer arrived by tap or from the home page.

**Embedded apps (`immerse`).** A shortcut can open framed inside `/accessory/app/[n]`, under our own bar.
- **Opt-in:** the project writes `preferredPresentation: "immerse"` on a wallet shortcut (on its own host). Phantom's default is `immerse`, but its meaning is left to each platform, so it only counts when written. The project's site must also allow us to frame it: the Worker reads its `frame-ancestors` / `X-Frame-Options` (CSP wins; every policy must allow us). It also requires a 2xx with no cross-origin redirect, edge-cached 10 minutes, and never sends a session proof, since the check would spend its single use. A refusal turns `immerse` off, so the tile opens as a normal link.
- **Launch page:** `/accessory/app/[n]` looks everything up again from the session; `n` only picks a position in the project's file. It requires the shortcut to still be `immerse`, on an origin other than ours, and still framable.
  - It signs the frame's proof only once framing is certain. "Open in new tab" goes through `/shortcut/[n]`, which mints its own on click.
  - It sets `locals.frameSrc`, which `hooks.server.ts` appends as `frame-src <origin>` to SvelteKit's CSP for that one response. A second CSP header can only narrow a policy, never allow a frame.
  - Links into and out of the page are full loads (`data-sveltekit-reload`), so the widened policy never lingers on other pages.
- **The frame:** `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`. `allow-same-origin` is safe only because the origin is never ours. There's no top navigation, `allow="fullscreen; clipboard-write"` and `referrerpolicy="no-referrer"`.
- **No passkeys in the frame.** `publickey-credentials-get` stays `(self)` and isn't delegated. The program doesn't check where a tap was made (see threats), so a tap inside the frame could be a transfer tap for an unlocked card, under a page that says "Genuine". Framed apps sign users in with the session proof. Revisit once `set_linked_wallet` checks `expected_origins`.
- **Limits for projects:** wallets rarely inject into third-party frames, so no signing inside; framed third-party cookies are restricted (Safari blocks them).

**Session proofs.** Each shortcut that goes to the project itself (https, on the `external_url` host or a subdomain) gets `?revibase_session=<jwt>`. The project can then authenticate the viewer without another tap or wallet signature. Third-party links (socials, Solana Pay) never get one.
- **Format:** an EdDSA (Ed25519) JWT, `typ: revibase-session+jwt`. It is signed with `SESSION_PROOF_KEY`, a 32-byte seed used for nothing else.
  - Cookies stay HMAC under `SESSION_SECRET`, which also derives the pairing code, so a proof can never be replayed here as a session.
  - The public keys are served as a JWKS at `/.well-known/session.json`.
  - If the key is unset, proofs are off and that route answers 404.
- **Claims:** `iss` (this app's origin) · `aud` (the shortcut's origin) · `iat`/`exp` · `jti` · `sub` (accessory PDA) · `mint` · `kind` (`bearer` | `controlled` | `permanent`) · `wallet` (on-chain linked wallet, or null).
- **Meaning:** the viewer may sign in as `wallet`. The browser holds a valid session for this accessory, whether it arrived by tap or signed in from the home page, and the proof doesn't say which. This is intended for every kind: whoever holds the accessory can sign in as its on-chain owner. For a Bearer collectible, that is true even before they claim it. The one exception: an owner_browse whose wallet is no longer the linked one gets no proofs.
- **Minted on open:** the list (`GET /api/accessory/shortcuts`) carries no proofs, only a `proof` flag on each shortcut that will get one. Opening such a shortcut goes through `GET /shortcut/[n]`, which signs a proof at that moment and 303s to the link. For a wallet shortcut opened from a phone browser, `?wallet=` wraps it in that wallet's browse deep link.
  - Nothing valid sits in the page, its HTML or its cache. The 5 minutes start at the tap, and only opened shortcuts get proofs.
  - It's a real navigation, not fetch plus `window.open`, so iOS still treats new tabs and wallet deep links as the user's own tap.
  - The route looks everything up again from the session; `n` only picks a position in the project's file. It serves only shortcuts that get a proof, so it's never a general redirect.
  - It refuses navigations whose `Sec-Fetch-Site` isn't `same-origin`, so another site can't send a signed-in viewer there to have a proof minted.
- **Lifetime:** 5 minutes from the tap, and never past the viewer's own session.
- **Residual risk (query parameter):** a proof is a bearer token in a URL, so it can reach the project's access logs, analytics and history, and a copied link carries it. That is bounded by the audience, the 5-minute expiry and single use. Projects should:
  - verify it on their backend;
  - refuse any `jti` they have seen before;
  - then redirect to the same URL without the parameter.

For projects:
```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://portal.revibase.com/.well-known/session.json'));

const { payload } = await jwtVerify(url.searchParams.get('revibase_session')!, JWKS, {
	issuer: 'https://portal.revibase.com',
	audience: 'https://game.xyz', // your origin, exactly
	algorithms: ['EdDSA'],
	typ: 'revibase-session+jwt'
});
// Then: reject a replayed payload.jti, and sign the viewer in as payload.wallet (null while unclaimed).
```

**Ownership wording.** On-chain, `linked_wallet` only proves which wallet the accessory points to, not who is holding the phone.
- By default the app says "Linked" or "Permanently linked" and labels the row "Linked wallet" (a Bearer collectible says "Owned by").
- It says "your wallet", "Ready to use" or "Permanently yours" only when `@solana/connector` has that same wallet connected in this browser, through a silent reconnect. There's no separate confirm step; owners manage their accessories from the home page.
- Success screens use "your wallet" only where the connected wallet just signed the link.

**UI:** shadcn-svelte (bits-ui) on Tailwind v4.
- Revibase brand: teal `#00C2B8` and cream `#F7F4EF`, from the app icon. The accessory is drawn as a Revibase tile carrying the traced mark (`src/lib/brand/RevibaseMark.svelte`).
- Light by default (cream background). Dark tokens exist in `layout.css` for a future toggle, but the app does not follow the system setting.
- Light mode uses a deeper teal (`#00766F`) for text and buttons: brand teal on cream is only 2:1, so it is kept for fills. Every text pairing is at least 5:1 (WCAG AA).
- Every screen has one heading, one line of copy and one primary action. Flows show a thin step bar instead of numbered lists. Grouped lists replace stacked cards.
- **Motion:**
  - buttons press to 98% in 75 ms;
  - screen content changes with a 240 ms fade and 4 px rise;
  - the verified check pops in once;
  - the only looping motion is a single ring while the app waits for a physical tap.
- Tap targets are at least 44 px, `aria-live` announces step changes, and `prefers-reduced-motion` collapses all motion.
- No Web3 jargon outside the Details sheet.

---

## 5. Code map

```
src/lib/server/
  tap/            verify-dynamic-url (port of phygital-wallet), counter-store (shared D1), handle-tap, resume (WebAuthn Hold)
  accessory/      resolve (identifier → PDA, cached), view (on-chain → AccessoryView + per-type rules), owner-browse,
                  shortcuts (external_url → the project's shortcuts.json)
  challenges.ts   single-use auth_challenges helpers (message challenges for resume · owner-browse)
  session/        HMAC cookies (bu · ob · hof · dsk · pair), proof (Ed25519 session proofs for project shortcuts)
  link/           service (ceremony + authorization), intents (D1 CAS), assertion (WebAuthn gate),
                  slot-window (SlotHashes), confirm, capability
src/lib/shared/   link-transaction (SDK completeTransfer → v0 tx, byte-level validator), types, encoding,
                  shortcuts (Phantom shortcuts.json → validated, resolved links)
src/lib/client/   wallet (connector headless + Wallet Standard signing), link/flow, messages (copy), rpc (browser client for `SOLANA_RPC_URL`), media and wallet-accessories reads,
                  shortcuts (how each project link opens on this device),
                  accessory/ (tapScreen · linkCopy · openOwned)
src/lib/components/app/   product components built from shadcn primitives in components/ui/
```

**Why sign through Wallet Standard directly?** `@solana/connector@0.2.6` is built on `@solana/kit` 7, while the SDK peers on kit 8. The app compiles transactions with kit 8 and hands the exact bytes to the wallet's `solana:signTransaction` feature. If a wallet only offers `solana:signAndSendTransaction`, it uses that instead. Connection, discovery and MWA still come from the connector.

---

## 6. Open items and assumptions

- **Deep links:** the Phantom, Backpack and Solflare browse formats follow their current docs; re-check them on real devices. Jupiter is intentionally not offered as a deep link because it publishes no browse link. If the connector detects it, it still appears as a normal wallet.
- **Chip binding:** the issuer's honesty is what binds `identifier` (NDEF key) and `public_key` (FIDO key) to the same chip. Nothing on-chain proves it.
- **iOS wallet browsers** can't run WebAuthn for our rpId, which is why the tap stays in Safari or Chrome.
- **Collectible artwork:**
  - When an accessory has a bound `mint`, the app shows its artwork instead of the Revibase tile.
  - The browser reads the accessory's `mint` from the chain, then calls DAS `getAsset` on `SOLANA_RPC_URL`, preferring the image-CDN copy (`cdn_uri`), then `links.image`.
  - The same call supplies the collectible's name, collection and traits. Nothing is stored in D1, and the client memoises per page session.
  - Only `https` images are used; `ipfs://` and `ar://` links go through public gateways.
- **Client cache (TanStack Query, `src/lib/client/queries.ts`):**
  - Accessory media is fresh for an hour once artwork exists (five minutes without), kept for a day, and persisted to `localStorage` (`revibase-query-cache`, buster `v1`). A returning visitor sees names and artwork on first paint with no DAS call.
  - The wallet's accessory list is memory-only and always revalidated. It is shown instantly on return, and dropped as soon as a link or unlink is confirmed (`forgetWalletAccessories`).
  - Only `accessory-media` queries are persisted. Bump `CACHE_BUSTER` when a cached shape changes.
- **Rate limiting** should be configured at the Cloudflare edge for `/`, `/api/link`, `/api/pair/claim`, and `/api/handoff/claim`.
- **Program follow-up:** optional `expected_origins` on `set_linked_wallet` (see threats above).
