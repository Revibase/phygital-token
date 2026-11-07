# Revibase

Revibase is a tap-to-claim web app for Revi cards. It is built with Next.js 16 and React 19, deployed to Cloudflare Workers through OpenNext, and uses Privy for wallets, D1 for storage and `phygital-token-sdk`.

## Develop

```bash
pnpm install                              # from the repo root
cp app/.dev.vars.example app/.dev.vars    # NEXT_PUBLIC_SOLANA_RPC_URL / _CLUSTER / _PRIVY_APP_ID, SESSION_SECRET
pnpm --filter revibase exec wrangler d1 execute DB --local --file test/support/schema.sql
pnpm --filter revibase dev
pnpm --filter revibase check && pnpm --filter revibase test
pnpm --filter revibase deploy
```

- **Configuration.**
  - `NEXT_PUBLIC_*` values reach the browser, which calls the RPC directly. Point `NEXT_PUBLIC_SOLANA_RPC_URL` at a public proxy that also serves DAS (`getAssetsByOwner`, for wallet token names and icons), never at a URL that contains a key.
  - Set `SESSION_SECRET` and `ISSUER_SECRET_KEY` (AdminConfig's issuer, base64 64-byte secret key) with `wrangler secret put`.
  - `ATTESTATION_ROOT_CERTS` lists the Revi attestation root CA(s) as comma-separated base64 DER. It is public; `ATTESTATION_AAGUID` (hex) is optional.
- **Database.** There is one D1 binding, `DB`, and its schema is `test/support/schema.sql`.
  - `phygital_tokens` and `admin_config` are snapshots of the on-chain accounts. Only the Helius webhook (`POST /api/webhooks/helius`) writes them, by replaying the append-only `program_events` log of the program's events. Nothing else, including enrollment and the developer service, may write them.
  - Set up a Helius **raw** webhook on the program address, pointed at `/api/webhooks/helius`, with `authHeader` set to `HELIUS_WEBHOOK_AUTH` (`wrangler secret put`).
  - Other services own `tap_counters` and `auth_challenges`. Every service must share them, so each chip has one counter.
  - Name this app's migrations `revibase_*`, and never edit one that has already been applied.

## Access

| Entry           | Grants                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Signed NFC URL  | Ten-minute `browse_unlock`: inspect the accessory and claim it. For a card with no token yet, a ten-minute `enroll` instead. |
| Wallet sign-in  | Thirty-day `owner_session`, then a view-only `owner_browse` while the wallet still owns the token.                           |
| Fresh tap       | Claiming (`set_owner`); the connected wallet signs and pays.                                                                 |
| Owner signature | Release (`remove_owner`), except for Permanent tokens.                                                                       |

- **Signed NFC URLs.** Check the URL's signature before consuming the shared `tap_counters` mark, and ignore prefetches. Then redirect to a clean URL with `no-store` and `no-referrer`. A URL's `pk` is the chip's NDEF key, not the card key: find the token by its on-chain `identifier` (`fetchAccessoryByIdentifier`, a `getProgramAccounts` scan), then derive the PDA from `public_key`. Nothing is cached; the chain is the only source.
- **Sessions.** Challenges are single-use, except enrollment's (below). Session cookies are HMAC-signed, HttpOnly, Secure and SameSite=Lax. Stateful APIs require same-origin requests, and the tap endpoints are rate-limited at the Cloudflare edge.
- **Claiming.**
  - The claim runs in the browser, through `src/lib/shared/set-owner.ts`. Connect the wallet, build the challenge for that wallet, tap, then send `[secp256r1 verify, set_owner]`.
  - iOS needs the tap to start straight from a click, with no network wait first.
  - Transactions are v1: compute limit, priority fee and loaded-data limit live in the message header. The app checks the transaction bytes before and after the wallet signs, and rejects unexpected signers or lookup tables.
- **Enrolling a card.** A card has no product key until someone enrolls it, so a verified tap whose `pk` has no token gets a ten-minute `enroll` cookie and lands on `/enroll`.
  - The page renders the challenge: an HMAC of the enroll cookie's session id (`enrollChallenge`). It is bound to that cookie and lasts as long as it, so nothing is fetched or refreshed, and iOS gets the prompt straight from the click. The browser enrolls the card over it with the SDK's `enrollCard` (one `navigator.credentials.create`) and posts the result to `/api/enroll`.
  - The tap's `pk` is self-asserted, so the attestation is what gates enrollment: only a genuine card can initialize a token.
  - It isn't single-use, and needn't be: the attestation proves a genuine card, the origin check proves this site, and `initialize` is once per card, so replaying an enrollment only repeats the same result.
  - The server checks the `clientDataJSON` (a `webauthn.create` on this origin over that challenge) and that the packed attestation's `x5c` reaches a root in `ATTESTATION_ROOT_CERTS` (`src/lib/shared/attestation.ts`).
  - It then sends `initialize` for an unowned Controlled token, `identifier` = the tap's `pk`, signed and paid for by the issuer (`ISSUER_SECRET_KEY`), in `registerCard` (`src/lib/server/enroll/initialize.ts`). The Helius webhook then records it in `phygital_tokens`.
  - The transaction has a fixed budget, `INITIALIZE_BUDGET`, measured on a local validator, and no extra simulation: the RPC's preflight rejects a failing send before any fee is paid. Re-measure it if the program's `initialize` changes, or if the program grows past 1 MiB.
  - Only genuine cards pass the attestation, and each product key initializes once, so the issuer pays rent for at most one account per card.
  - Retrying is safe. The card's `create` is idempotent (it returns the same product key, freshly attested), and a token an earlier attempt already initialized for this card counts as done.
  - Setup is step 1 of 4: on success the browser goes straight to `/accessory/link?setup=1`, whose three claim steps continue the count.
- **Ownership.**
  - A tap proves the card was present. It doesn't prove control of a wallet, and the on-chain owner and whoever holds the card can differ.
  - A Bearer token can be claimed again while it's unlocked. A Controlled token must be released first, and a Permanent token never changes owner (`accessoryRules`).
