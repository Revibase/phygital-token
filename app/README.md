# Revibase

A mobile-first SvelteKit app (package and worker `revibase`) on Cloudflare Workers. Users tap to inspect an accessory, link a wallet, and open project apps. A tap authenticates the accessory, not control of wallet keys or NFT ownership.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the protocol model, trust boundaries and ceremony design.

Stack: SvelteKit 2 · Svelte 5 · Tailwind v4 + shadcn-svelte · `@solana/kit` 8 · `@solana/connector` · `phygital-token-sdk` (workspace) · Cloudflare D1.

## Develop

```bash
pnpm install                          # from the repo root (the app is a workspace package)
cp app/.dev.vars.example app/.dev.vars
pnpm --filter revibase db:migrate:local
pnpm --filter revibase dev
```

`.dev.vars` sets `SOLANA_RPC_URL`, `SESSION_SECRET` (32+ chars) and, optionally, `SOLANA_CLUSTER`. `RP_ID` in `wrangler.jsonc` is the WebAuthn relying party used to build the transfer challenge, and `ORIGIN` is the base URL for handoff and pairing links; both must match the origin the tap page is served from.

### Without hardware: local validator + software accessory

```bash
solana-test-validator --reset --bpf-program DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ target/deploy/phygital_token.so
# app/.dev.vars: SOLANA_RPC_URL=http://127.0.0.1:8899  SOLANA_CLUSTER=localnet

pnpm --filter revibase dev:accessory init
pnpm --filter revibase dev:accessory add mine controlled   # bearer | controlled | permanent
pnpm --filter revibase dev:accessory tap mine              # prints an NFC tap URL to open
pnpm --filter revibase dev:accessory link mine             # links it to a fresh wallet
```

## Test

```bash
pnpm --filter revibase check      # svelte-check
pnpm --filter revibase test       # unit tests (real SQL via node:sqlite)
pnpm --filter revibase e2e:local  # ceremonies against a fresh local validator
pnpm --filter revibase dev:simulation  # UI preview without hardware, localhost:4187
pnpm --filter revibase test:browser    # run with the simulation server active
```

## Deploy

Run `pnpm --filter revibase deploy` to build, check the production output for test fixtures, then deploy. Production builds reject imports from test and script directories; the simulation configuration cannot build. Mockups are served only by the simulation server.

There is **one** D1 binding, `DB`: the shared `phygital-token` database that phygital-wallet's API also uses.

- **Shared tables:** `tap_counters` and `auth_challenges`. Their schema is owned by phygital-wallet.
  - `tap_counters` must be shared so there is one tap-counter high-water mark per chip across every service.
  - Resume and owner-login challenges are stored in `auth_challenges` under their own namespaces (message string → `startAuthentication` / `verifyResponse`).
- **This app's tables:** `revibase_link_intents` and `revibase_identifier_cache`.
- **Migrations:** apply the app's own with `wrangler d1 migrations apply DB --remote`. The files are prefixed `revibase_` so they never clash with phygital-wallet's migration history. `revibase_0000_shared_tables_mirror.sql` only mirrors the shared tables for local dev; it uses `IF NOT EXISTS` and is a no-op remotely.
- Set `SESSION_SECRET` with `wrangler secret put`. `SOLANA_RPC_URL` is sent to the browser, which calls it directly (reads, DAS and sending), so it must be your public RPC proxy Worker, not a URL with an API key. Set it as a plain var.
