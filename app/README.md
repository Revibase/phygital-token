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

`.dev.vars` sets `SOLANA_RPC_URL`, `SESSION_SECRET` (32+ chars), `SECURE_SIGNER_ORIGIN` and, optionally, `SOLANA_CLUSTER`. `RP_ID` in `wrangler.jsonc` is the WebAuthn relying party (for accessory taps and passkey wallets) and must match the host the tap page is served from. The server checks that each tap was signed on the origin of the request it arrives on. `SECURE_SIGNER_ORIGIN` is where the passkey-wallet iframe is served: run it beside the app with `pnpm --filter secure-signer dev` (port 5174). `SPONSOR_KEYS` (comma-separated base58 64-byte secret keys) is the fee-payer pool behind `/api/sponsor`; fund each key on your cluster (`solana airdrop 1 <address> -u devnet`). Without it, owners pay every fee themselves. The `SPONSOR_*` vars in `wrangler.jsonc` set the prepaid amount per accessory and the fee caps.

### Without hardware: local validator + software accessory

```bash
solana-test-validator --reset --bpf-program phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz target/deploy/phygital_token.so
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
pnpm --filter revibase e2e:local  # taps, links and fees against a fresh local validator
pnpm --filter revibase dev:simulation  # UI preview without hardware, localhost:4187
pnpm --filter revibase test:browser    # run with the simulation server active
```

### End to end: real app, signer and chain

`pnpm test:e2e` drives the real app, the real secure-signer iframe and a local validator in a browser. WebAuthn is a virtual authenticator in the test process (`test/e2e/webauthn-bridge.ts`), shared by every frame, so passkey creation on the app, PRF in the signer frame and NFC accessory taps all run without hardware or OS prompts. Everything that consumes the credentials stays real. It runs over HTTPS, as in production: WebKit keeps the signer's `Secure; Partitioned` vault cookie only there, and blocks a plain-HTTP RPC from an HTTPS page.

The validator must support v1 transactions (Agave 4.x):

```bash
solana-test-validator --reset --bpf-program phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz target/deploy/phygital_token.so
pnpm --filter revibase e2e:setup                                     # accessories, fee payers, D1, TLS cert
REVIBASE_PLATFORM=e2e NODE_EXTRA_CA_CERTS=$PWD/app/.wrangler/e2e/tls/cert.pem pnpm --filter revibase dev   # https://localhost:5173
pnpm --filter secure-signer exec vite --mode e2e                      # https://localhost:5174
pnpm --filter revibase test:e2e                                       # system Chrome
E2E_ENGINE=webkit pnpm --filter revibase test:e2e                     # WebKit
```

`E2E_FILTER=regex` runs matching scenarios; `E2E_HEADED=1` shows the browser. The e2e stack has its own bindings (`test/e2e/wrangler.jsonc`), secrets (`test/e2e/.dev.vars`) and D1 store (`.wrangler/e2e`), so it never touches your `.dev.vars`. The app also serves the validator at `/__e2e/rpc` in this mode.

Scenarios cover the passkey wallet (create, reload, restore on a new phone, unknown passkey, export), claiming, owner sign-in, permission requests, SOL, token and send-all transfers, release with sweep, tap-to-sign from another site within limits and allowed sites, recovery from cancels and dismissed prompts, a hostile parent posting crafted messages to the signer, and a foreign site framing it. After each scenario a leak scan checks that no PRF output reached the app, the network or app storage. Every signer confirm screen is saved to `test/e2e/results/signer/` for review.

### NFT transfers

Standard SPL NFTs, programmable NFTs, Core and compressed NFTs share the same recipient-only send form and Send all flow. Programmable source token accounts are normally frozen; this does not block Token Metadata transfers. Rule sets, Core plugins and compressed-NFT freeze/non-transferable flags remain enforced; failures stop before signing. Missing/incomplete DAS indexing is disclosed rather than silently reporting a complete portfolio. Discovery currently bounds pagination to 4,000 indexed assets and reports incomplete results.

For local chain verification of NFT transfers, build the SDK and program, then run from the repository root:

```sh
NFT_PROGRAM_FIXTURES=/path/to/pinned/metaplex/programs pnpm -C app e2e:nfts
```

The directory needs the Metaplex program binaries and a `manifest.json` listing each as `{ "id", "file", "sha256", "group": "metaplex" }`; dump them from mainnet with `solana program dump -um <id> <file>`. The harness checks SHA-256 pins and runs entirely in LiteSVM against this repository's `target/deploy/phygital_token.so`. It mints disposable assets to an accessory wallet and checks actual owner-authorized CPI transfers: an allowing pNFT rule set and recipient token record; a denying rule set leaving ownership intact; a Core collection transfer and stale-owner rejection; an invalid compressed proof leaving the root intact; and a successful Bubblegum V1 transfer matching the independently computed recipient leaf/root. Bubblegum V2 routing, hash/flag/collection encoding and separate nonce/index handling are unit tested. No live wallet or blockchain transactions are used. Final simulation tests ensure a changed rule set prevents a wallet signature and the simulated transaction matches the transaction handed to the wallet.

Wallet transactions use v1 with inline accounts and a 4,096-byte size limit; address lookup tables are unnecessary. Compressed-NFT proofs still need to fit the 64-account and transaction-size limits. Creator rules/plugins requiring extra authorization data or additional signers may reject the transfer during simulation. The app does not bypass these restrictions.

## Deploy

Run `pnpm --filter revibase deploy` to build, check the production output for test fixtures, then deploy. Production builds reject imports from test and script directories; the simulation configuration cannot build. Mockups are served only by the simulation server.

Set the fee-payer pool with `wrangler secret put SPONSOR_KEYS` and keep its keys funded: a key below `SPONSOR_MIN_KEY_LAMPORTS` stops being offered. Apply the migrations (including `revibase_0009_sponsor_ledger.sql` and `revibase_0010_drop_link_intents.sql`) before deploying.

There is **one** D1 binding, `DB`. In production it can be shared with other services that accept the same tap URLs. Replace the placeholder `database_id` in `wrangler.jsonc` with your database's before deploying (`wrangler d1 create phygital-token`).

- **Shared tables:** `tap_counters` and `auth_challenges`. Their schema is owned outside this app; see [migrations/README.md](migrations/README.md).
  - `tap_counters` must be shared so there is one tap-counter high-water mark per chip across every service.
  - Resume and owner-login challenges are stored in `auth_challenges` under their own namespaces (message string → `startAuthentication` / `verifyResponse`).
- **This app's tables:** `revibase_identifier_cache`, `revibase_signer_wallets` and `revibase_sponsor_txs`.
- **Migrations:** apply the app's own with `wrangler d1 migrations apply DB --remote`. The files are prefixed `revibase_` so they never clash with another service's migration history in a shared database. `revibase_0000_shared_tables_mirror.sql` only mirrors the shared tables for local dev; it uses `IF NOT EXISTS` and is a no-op remotely.
- Set `SESSION_SECRET` with `wrangler secret put`. `SOLANA_RPC_URL` is sent to the browser, which calls it directly (reads, DAS and sending), so it must be your public RPC proxy Worker, not a URL with an API key. Set it as a plain var.

### Local click-through preview

Run `pnpm -C app dev:simulation --host 127.0.0.1` from the repository root, then open [the preview launcher](http://127.0.0.1:4187/__simulation). It offers a funded accessory, a simulated Phantom wallet, a transfer preset, existing limits, permission-request reviews and a paused-fee example. Launcher scenarios enable the phone UI in desktop browsers.

Click **Phantom** when prompted. Permission saves and approvals update browser-local state and survive reloads; starting another launcher scenario resets that state. No transactions are signed or sent. Sends and fee refills remain outside this preview. The simulation is restricted to the local dev server and its fixtures are excluded from production builds.

## UI and implementation guide

Read [the accessory and wallet journey](../docs/wallet-ux.md) for the current mobile flows, claim and management behavior. These describe the implemented experience, including program-scoped saves and browser-only shortcuts.

Use the shared shadcn components in `src/lib/components/ui` and the app primitives in `src/lib/components/app` (see “Shared client and UI boundaries” in ARCHITECTURE.md) rather than restyling controls. `WalletConnect` is the one way to connect a wallet; `OwnerApproval` gates transaction actions. Viewing balances and receiving assets do not require a connected owner wallet.

Shared client utilities own clipboard feedback (`clipboard.ts`) and JSON requests (`api.ts`). QR generation loads on demand and discards outdated results. Asset metadata requests deduplicate missing mints. Keep native IDLs pinned and unmodified; their parsed cache is shared across editor mounts.
