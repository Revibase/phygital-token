# Contributing

Thanks for helping. Security reports go through [SECURITY.md](SECURITY.md), not
issues or pull requests.

## Setup

| Tool | Version | Pinned in |
|------|---------|-----------|
| Rust (host) | 1.98.1 | `rust-toolchain.toml` |
| Solana CLI | 3.1.10 | `Anchor.toml` |
| Anchor CLI | 1.0.2 | `Anchor.toml` |
| Node.js | 24 (≥ 22.12) | `.nvmrc` |
| pnpm | 11.9.0 | `package.json` `packageManager` |

```bash
pnpm install
NO_DNA=1 anchor build   # builds the program .so the Rust tests load
```

## Checks

CI runs all of these; run them before opening a pull request.

```bash
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo deny check

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter phygital-token-sdk api:check
```

## Changing the program

- The program's instruction names, arguments, account layouts, PDA seeds and
  error codes are its public interface. Error variants are append-only: never
  reorder or remove one, because clients match on the numeric code.
- After changing the program, run `pnpm build:program`. It rebuilds the program,
  copies the IDL to `idl/` and regenerates the TypeScript and Rust clients.
  Commit the regenerated files; CI fails if they drift from the source.
- Never edit `packages/*/*/src/generated/` by hand.
- Add a LiteSVM test in `programs/phygital-token/tests/` for every new check,
  including the failure path.

## Changing the SDK's public API

`packages/js/phygital-token/api/phygital-token-sdk.api.md` records the exported
surface. If your change adds, removes or changes an export, run
`pnpm --filter phygital-token-sdk api:update` and commit the report so the
change is visible in review.

## Versioning

Each published artifact is versioned independently with semantic versioning
and has its own `CHANGELOG.md`:

| Artifact | Version source |
|----------|----------------|
| On-chain program | `programs/phygital-token/Cargo.toml` (also in the IDL metadata) |
| `phygital-token-sdk` | `packages/js/phygital-token/package.json` |
| `phygital-token-client` | `packages/rust/phygital-token/Cargo.toml` |
| `phygital-token-mcp` | `packages/mcp/phygital-token/package.json` |

A program release that changes the IDL requires a new client release.

## Commits and pull requests

- Keep each pull request to one concern. Separate mechanical changes (renames,
  formatting, moves) from behavior changes so reviewers can check each.
- Prefix security fixes with `fix(security):` and include a test that fails
  without the fix.
- Write commit messages that say why, not only what.
