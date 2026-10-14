# Audit scope

What to review, in priority order, and what is out of scope. Pin the review to
a commit; line counts below are hand-written source only (generated code,
vendored IDL JSON and test files excluded) and were taken at the commit that
added this file.

## In scope

| Priority | Component | Path | Lines | Start at |
|----------|-----------|------|-------|----------|
| 1 | On-chain program | `programs/phygital-token/src` | ~1,700 (incl. inline unit tests) | [`src/lib.rs`](../../programs/phygital-token/src/lib.rs), [INVARIANTS](../program/INVARIANTS.md), [THREAT_MODEL](../program/THREAT_MODEL.md) |
| 2 | App server (Cloudflare Worker) | `app/src/lib/server`, `app/src/hooks.server.ts`, `app/src/routes/**/+server.ts`, `+page.server.ts` | ~2,300 | [app/ARCHITECTURE.md](../../app/ARCHITECTURE.md) |
| 3 | TypeScript SDK | `packages/js/phygital-token/src` (excluding `generated/`) | ~1,400 | [README](../../packages/js/phygital-token/README.md), [API report](../../packages/js/phygital-token/api/phygital-token-sdk.api.md) |
| 4 | App shared and client code that builds or checks transactions | `app/src/lib/shared`, `app/src/lib/client/link` | ~1,300 | [app/ARCHITECTURE.md](../../app/ARCHITECTURE.md) |

Highest-value questions:

1. **Program:** can a tap be forged, replayed or used for another token
   (T1–T5)? Can a locked token change owner (O1–O2)? Does `verify` honour its
   optional rpId and origin checks? Note the accepted limitation that a tap does
   not name its recipient (threat model).
2. **App server:** can a request obtain a session, a counter, or control of a
   link ceremony (the handoff and pairing capabilities) it should not?
3. **SDK:** does the `set_owner` challenge encoding match the program byte for
   byte (shared test vector in both test suites), and does `verifyResponse`
   check what its docs say?

## Out of scope

- Generated code: `packages/js/phygital-token/src/generated`,
  `packages/rust/phygital-token/src/generated`, `idl/`. They are regenerated
  from the program and CI fails if they drift.
- `packages/mcp/phygital-token`: an offline documentation server that holds
  no keys and sends no transactions.
- App UI components and pages that only display data.
- Test harnesses (`*/tests`, `*/test`, `app/scripts`).
- Third-party dependencies (checked by `cargo deny` and Dependabot), the Solana
  runtime and the secp256r1 precompile, Cloudflare, and the authenticator
  hardware.
- Volume-based denial of service against the public endpoints; rate limiting
  is configured at the edge (see DESIGN_DECISIONS).

## Trust assumptions

Recorded in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) and the threat models.
The program's admin, issuer and minter are trusted; so is the program upgrade
authority. `SESSION_SECRET` is a server secret.

## How to run everything

See [BUILD.md](BUILD.md). In short: `NO_DNA=1 anchor build && cargo test`,
then `pnpm install && pnpm --filter phygital-token-sdk build && pnpm test`.
