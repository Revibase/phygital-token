# Revibase

A mobile-first Next.js app (package and worker `revibase`) on Cloudflare Workers via OpenNext. Users tap to inspect an accessory, claim it with a wallet, and open project apps. A tap authenticates the accessory, not control of wallet keys or NFT ownership.

Claiming happens directly in the browser: the accessory provides a WebAuthn assertion, the wallet signs the claim transaction, and the browser submits it to Solana RPC. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the protocol model and trust boundaries.

Stack: Next.js 16 · OpenNext Cloudflare · React 19 · Tailwind v4 + shadcn · Privy · `@solana/kit` 8 · `phygital-token-sdk` (workspace) · Cloudflare D1.

## Develop

```bash
pnpm install                          # from the repo root (the app is a workspace package)
cp app/.dev.vars.example app/.dev.vars
pnpm --filter revibase exec wrangler d1 execute DB --local --file test/support/schema.sql
pnpm --filter revibase dev
```

`.dev.vars` sets `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_PRIVY_APP_ID`, and `SESSION_SECRET` (32+ chars). The `NEXT_PUBLIC_` values are sent to the browser. Tap assertions are checked against the origin of the request that submits them. Wallets sign in through Privy. Email sign-in creates an embedded Solana wallet when the account does not already have one.

## Test

```bash
pnpm --filter revibase check      # wrangler types and tsc
pnpm --filter revibase test       # unit tests (real SQL via node:sqlite)
```

## Deploy

Run `pnpm --filter revibase deploy` to build, then deploy. Production builds reject imports from test code.

There is **one** D1 binding, `DB`. In production it can be shared with other services that accept the same tap URLs. Replace the placeholder `database_id` in `wrangler.jsonc` with your database's before deploying (`wrangler d1 create phygital-token`).

D1 migrations are kept out of git. [`test/support/schema.sql`](./test/support/schema.sql) is the schema the app expects; the tests and local dev use it.

- **Shared tables:** `tap_counters` and `auth_challenges`. Their schema is owned outside this app.
  - `tap_counters` must be shared so there is one tap-counter high-water mark per chip across every service.
  - Resume and owner-login challenges are stored in `auth_challenges` under their own namespaces (message string → `startAuthentication` / `verifyResponse`).
- **This app's tables:** `revibase_identifier_cache`.
- **Migrations:** put them in `app/migrations` and apply them with `wrangler d1 migrations apply DB --remote`. Prefix them `revibase_` so they never clash with another service's migration history in a shared database. D1 records applied migrations by file name, so never rename or edit one that has already been applied.
- Set `SESSION_SECRET` with `wrangler secret put`. `NEXT_PUBLIC_SOLANA_RPC_URL` is sent to the browser, which calls it directly (reads, DAS, and sending), so it must be your public RPC proxy, not a URL with an API key. Set it as a plain var, along with `NEXT_PUBLIC_SOLANA_CLUSTER` and `NEXT_PUBLIC_PRIVY_APP_ID`.
