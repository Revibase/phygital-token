# Building, verifying and deploying

## Toolchain

| Tool | Version | Pinned in |
|------|---------|-----------|
| Rust (host: tests, clippy, rustfmt) | 1.98.1 | `rust-toolchain.toml` |
| Solana CLI (on-chain build) | 3.1.10 | `Anchor.toml` |
| Anchor CLI | 1.0.2 | `Anchor.toml` |
| Node.js | 24 (≥ 22.12) | `.nvmrc` |
| pnpm | 11.9.0 | `package.json` |

## Build and test everything

```bash
NO_DNA=1 anchor build                    # target/deploy/phygital_token.so + IDL
cargo test                               # program unit + LiteSVM integration tests
cargo clippy --all-targets -- -D warnings
cargo deny check

pnpm install --frozen-lockfile
pnpm --filter phygital-token-sdk build   # other packages build against it
pnpm lint && pnpm typecheck && pnpm test
```

## Regenerating the clients

The TypeScript and Rust clients are generated from the IDL with Codama:

```bash
pnpm build:program    # anchor build, copy the IDL to idl/, regenerate both clients, build the SDK
```

CI runs the same steps and fails if `idl/` or either `generated/` folder
differs from what is committed.

## Reproducible program build

```bash
cargo install solana-verify --version 0.5.2 --locked
solana-verify build --library-name phygital_token     # builds in solana-verify's pinned Docker image
solana-verify get-executable-hash target/deploy/phygital_token.so
```

The `verify` GitHub workflow runs the same build on `program-v*` tags and
prints the hash.

### Checking a deployed program

```bash
solana-verify get-program-hash -u mainnet-beta phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz
```

The two hashes must match. The deployed binary also embeds `security.txt`
(`solana-verify` and explorers display it).

## Deploying

1. Build verifiably (above) and record the hash.
2. Deploy: `solana program deploy target/deploy/phygital_token.so --program-id <keypair>`.
3. **Immediately** call `create_config` from the intended admin key. It makes
   its first caller the admin and can only run once. A newly deployed program
   cannot be invoked in the slot it was deployed, so there is always a short
   window; keep it short and do not announce the program id before this step.
4. Check the config: fetch `AdminConfig` at `["admin"]` and confirm `admin` is
   the intended key. If someone else got there first, the upgrade authority
   must upgrade the program to recover before anything else is done with it.
5. As admin, `set_issuer` and `set_minter`.
6. Decide the upgrade authority's future (a multisig, or revoke once stable)
   and record it in the release notes.

This procedure was chosen over requiring the upgrade authority inside
`create_config`; see [program threat model](../program/THREAT_MODEL.md#deployment).

## Web components

- App: `pnpm --filter revibase deploy` (Cloudflare Worker). Set the D1
  `database_id` and `ORIGIN` in `app/wrangler.jsonc`, the secret
  `SESSION_SECRET` with `wrangler secret put`, and apply the migrations
  (`wrangler d1 migrations apply DB --remote`).
