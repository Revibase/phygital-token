# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

A tap proves the accessory is genuine and present: authentication needs no wallet or SOL. A tap can also make a wallet the token's owner (`set_owner`). The app does that in the browser: the accessory signs, the connected wallet signs, and the browser submits the transaction.

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`packages/js/phygital-token`](./packages/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`packages/rust/phygital-token`](./packages/rust/phygital-token) | `phygital-token-client` |
| **phygital-token-mcp** | [`packages/mcp/phygital-token`](./packages/mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **revibase** | [`app`](./app) | tap-to-claim web app (SvelteKit on Cloudflare) |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ` |

## Documentation

Integrator guides are published on the Revibase developer site. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

| Topic | Read |
|-------|------|
| On-chain program | [README](programs/phygital-token/README.md), [invariants](docs/program/INVARIANTS.md), [threat model](docs/program/THREAT_MODEL.md) |
| App | [setup](app/README.md), [trust boundaries](app/ARCHITECTURE.md) |
| Packages | [TypeScript SDK](packages/js/phygital-token/README.md), [Rust CPI client](packages/rust/phygital-token/README.md), [MCP server](packages/mcp/phygital-token/README.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |

## License

MIT. See [LICENSE](./LICENSE).
