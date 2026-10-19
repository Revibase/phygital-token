# Revibase

A mobile-first SvelteKit app (package and worker `revibase`) on Cloudflare Workers. Users tap to inspect an accessory, claim it with a wallet, and open project apps. A tap authenticates the accessory, not control of wallet keys or NFT ownership.

Claiming happens directly in the browser: the accessory provides a WebAuthn assertion, the wallet signs the claim transaction, and the browser submits it to Solana RPC. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the protocol model and trust boundaries.

Stack: SvelteKit 2 · Svelte 5 · Tailwind v4 + shadcn-svelte · `@solana/kit` 8 · `@solana/connector` · `phygital-token-sdk` (workspace) · Cloudflare D1.

## Develop

```bash
pnpm install                          # from the repo root (the app is a workspace package)
cp app/.dev.vars.example app/.dev.vars
pnpm --filter revibase db:migrate:local
pnpm --filter revibase dev
```

`.dev.vars` sets `SOLANA_RPC_URL`, `SESSION_SECRET` (32+ chars) and, optionally, `SOLANA_CLUSTER`. Tap assertions are checked against the origin of the request that submits them.

### Revibase Passkey (optional)

The wallet picker also offers [revibase-wallet](https://github.com/jychab/revibase-wallet)'s passkey wallet when `SECURE_SIGNER_ORIGIN` and `FEE_PAYER_KEY` are both set. The SDK is a `file:` dependency on a sibling checkout (`../revibase-wallet`): build it there first (`pnpm build:sdk`), and run its signer with `VITE_PARENT_ORIGIN=http://localhost:5173` (`pnpm dev:signer`, on `:5174`). `FEE_PAYER_KEY` is a base58 64-byte secret key with SOL on the cluster.

## Test

```bash
pnpm --filter revibase check      # svelte-check
pnpm --filter revibase test       # unit tests (real SQL via node:sqlite)
```

## Deploy

Run `pnpm --filter revibase deploy` to build, then deploy. Production builds reject imports from test code.

There is **one** D1 binding, `DB`. In production it can be shared with other services that accept the same tap URLs. Replace the placeholder `database_id` in `wrangler.jsonc` with your database's before deploying (`wrangler d1 create phygital-token`).

- **Shared tables:** `tap_counters` and `auth_challenges`. Their schema is owned outside this app. D1 records applied migrations by file name, so never rename or edit one that has already been applied.
  - `tap_counters` must be shared so there is one tap-counter high-water mark per chip across every service.
  - Resume and owner-login challenges are stored in `auth_challenges` under their own namespaces (message string → `startAuthentication` / `verifyResponse`).
- **This app's tables:** `revibase_identifier_cache`. Migration `0014` drops the unused legacy `revibase_link_intents` table.
- **Migrations:** apply the app's own with `wrangler d1 migrations apply DB --remote`. The files are prefixed `revibase_` so they never clash with another service's migration history in a shared database. `revibase_0000_shared_tables_mirror.sql` only mirrors the shared tables for local dev; it uses `IF NOT EXISTS` and is a no-op remotely. `revibase_0014` removes the legacy link-intent table.
- Set `SESSION_SECRET` with `wrangler secret put`. `SOLANA_RPC_URL` is sent to the browser, which calls it directly (reads, DAS, and sending), so it must be your public RPC proxy, not a URL with an API key. Set it as a plain var.
- Revibase Passkey: `SECURE_SIGNER_ORIGIN` is a var (the deployed signer, whose `VITE_PARENT_ORIGIN` must be this app's origin). Set `FEE_PAYER_KEY` with `wrangler secret put` and keep at least 0.05 SOL in it. It only fronts fees and a new wallet's rent, and every transaction pays it back in full; only a transaction that fails on-chain costs it its fee. Rate-limit `/api/fee-payer` at the edge like the tap endpoints. The signer's credential map needs its own D1 database (see revibase-wallet `app/README.md`).
