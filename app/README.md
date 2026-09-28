# Revibase

`phygital-accessory-app`: a mobile-first SvelteKit app on Cloudflare Workers. It turns a Revibase NFC accessory into a physical extension of a Solana wallet: tap the accessory, link a wallet once with `set_linked_wallet`, and after that a tap signs you in as that wallet.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the protocol model, trust boundaries and ceremony design.

Stack: SvelteKit 2 · Svelte 5 · Tailwind v4 + shadcn-svelte · `@solana/kit` 8 · `@solana/connector` · `phygital-token-sdk` (workspace) · Cloudflare D1.

## Develop

```bash
pnpm install                          # from the repo root (the app is a workspace package)
cp app/.dev.vars.example app/.dev.vars
pnpm --filter phygital-accessory-app db:migrate:local
pnpm --filter phygital-accessory-app dev
```

`.dev.vars` sets `SOLANA_RPC_URL`, `SESSION_SECRET` (32+ chars) and, optionally, `SOLANA_CLUSTER`. `RP_ID` and `ORIGIN` in `wrangler.jsonc` must match the exact origin the tap page is served from, because WebAuthn is bound to them.

### Without hardware: local validator + software accessory

```bash
solana-test-validator --reset --bpf-program DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ target/deploy/phygital_token.so
# app/.dev.vars: SOLANA_RPC_URL=http://127.0.0.1:8899  SOLANA_CLUSTER=localnet

pnpm --filter phygital-accessory-app dev:accessory init
pnpm --filter phygital-accessory-app dev:accessory add mine controlled   # bearer | controlled | permanent
pnpm --filter phygital-accessory-app dev:accessory tap mine              # prints an NFC tap URL to open
pnpm --filter phygital-accessory-app dev:accessory link mine             # links it to a fresh wallet
```

## Test

```bash
pnpm --filter phygital-accessory-app check      # svelte-check
pnpm --filter phygital-accessory-app test       # unit tests (real SQL via node:sqlite)
pnpm --filter phygital-accessory-app e2e:local  # full ceremonies against the real program (fresh validator)
```

## Deploy

- `TAP_DB` binds the **shared** `phygital-token` D1 database; only its `tap_counters` table is used, and its schema is owned by phygital-wallet.
- `APP_DB` is this app's own database. Create it with `wrangler d1 create phygital-accessory`, put the id in `wrangler.jsonc`, and apply `migrations/`.
- Set the `SOLANA_RPC_URL` and `SESSION_SECRET` secrets with `wrangler secret put`.
