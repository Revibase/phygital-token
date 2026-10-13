# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

A tap proves the accessory is genuine and present: authentication needs no wallet or SOL. A tap can also make a wallet the token's owner (`set_owner`), which the app finishes in a wallet app's browser or on a computer (handoffs). See [GLOSSARY.md](./GLOSSARY.md).

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`packages/js/phygital-token`](./packages/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`packages/rust/phygital-token`](./packages/rust/phygital-token) | `phygital-token-client` |
| **phygital-token-mcp** | [`packages/mcp/phygital-token`](./packages/mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **revibase** | [`app`](./app) | tap-to-claim web app (SvelteKit on Cloudflare) |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz` |

## Documentation

Integrator guides (authenticate, check access, claim ownership) are published on the Revibase developer site.

**Security review:** start with [docs/audit/SCOPE.md](docs/audit/SCOPE.md), then
[ARCHITECTURE](docs/audit/ARCHITECTURE.md) (trust boundaries),
[DESIGN_DECISIONS](docs/audit/DESIGN_DECISIONS.md) (accepted risks) and
[BUILD](docs/audit/BUILD.md) (reproducible builds and deployment).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

| Topic | Read |
|-------|------|
| On-chain program | [README](programs/phygital-token/README.md) (every instruction), [invariants](docs/program/INVARIANTS.md), [threat model](docs/program/THREAT_MODEL.md) |
| App | [setup and testing](app/README.md), [architecture and security boundaries](app/ARCHITECTURE.md) |
| Packages | [TypeScript SDK](packages/js/phygital-token/README.md), [Rust CPI client](packages/rust/phygital-token/README.md), [MCP server](packages/mcp/phygital-token/README.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md) |

## License

MIT. See [LICENSE](./LICENSE).
