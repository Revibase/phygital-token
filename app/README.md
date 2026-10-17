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

`.dev.vars` sets `SOLANA_RPC_URL`, `SESSION_SECRET` (32+ chars), `ORIGIN` and, optionally, `SOLANA_CLUSTER`. `RP_ID` in `wrangler.jsonc` is the WebAuthn relying party for accessory taps and must match the host the tap page is served from. `ORIGIN` is used to validate tap assertions.

### Without hardware: local validator + software accessory

```bash
solana-test-validator --reset --bpf-program DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ target/deploy/phygital_token.so
# app/.dev.vars: SOLANA_RPC_URL=http://127.0.0.1:8899  SOLANA_CLUSTER=localnet

pnpm --filter revibase dev:accessory init
pnpm --filter revibase dev:accessory add mine controlled   # bearer | controlled | permanent
pnpm --filter revibase dev:accessory tap mine              # prints an NFC tap URL to open
pnpm --filter revibase dev:accessory link mine             # claims it with a fresh wallet via Solana RPC
```

## Test

```bash
pnpm --filter revibase check      # svelte-check
pnpm --filter revibase test       # unit tests (real SQL via node:sqlite)
pnpm --filter revibase e2e:local  # direct claims and ownership rules against a fresh local validator
pnpm --filter revibase dev:simulation  # UI preview without hardware, localhost:4187
pnpm --filter revibase test:browser    # run with the simulation server active
```

## Deploy

Run `pnpm --filter revibase deploy` to build, check the production output for test fixtures, then deploy. Production builds reject imports from test and script directories; the simulation configuration cannot build. Mockups are served only by the simulation server.

There is **one** D1 binding, `DB`. In production it can be shared with other services that accept the same tap URLs. Replace the placeholder `database_id` in `wrangler.jsonc` with your database's before deploying (`wrangler d1 create phygital-token`), and set `ORIGIN` to the app's public URL.

- **Shared tables:** `tap_counters` and `auth_challenges`. Their schema is owned outside this app; see [migrations/README.md](migrations/README.md).
  - `tap_counters` must be shared so there is one tap-counter high-water mark per chip across every service.
  - Resume and owner-login challenges are stored in `auth_challenges` under their own namespaces (message string → `startAuthentication` / `verifyResponse`).
- **This app's tables:** `revibase_identifier_cache`. Migration `0014` drops the unused legacy `revibase_link_intents` table.
- **Migrations:** apply the app's own with `wrangler d1 migrations apply DB --remote`. The files are prefixed `revibase_` so they never clash with another service's migration history in a shared database. `revibase_0000_shared_tables_mirror.sql` only mirrors the shared tables for local dev; it uses `IF NOT EXISTS` and is a no-op remotely. `revibase_0014` removes the legacy link-intent table.
- Set `SESSION_SECRET` with `wrangler secret put`. `SOLANA_RPC_URL` is sent to the browser, which calls it directly (reads, DAS, and sending), so it must be your public RPC proxy, not a URL with an API key. Set it as a plain var.
