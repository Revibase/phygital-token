# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

A tap proves the accessory is genuine and present. That is the core: authentication needs no wallet, policy or SOL.

Optionally, each token also has a wallet PDA that can hold assets. Its owner can run any instructions as the wallet; the accessory can too, but only once the owner creates a policy allowing it (blocked by default). See [GLOSSARY.md](./GLOSSARY.md).

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`packages/js/phygital-token`](./packages/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`packages/rust/phygital-token`](./packages/rust/phygital-token) | `phygital-token-client` |
| **phygital-token-mcp** | [`packages/mcp/phygital-token`](./packages/mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **revibase** | [`app`](./app) | tap-to-link web app (SvelteKit on Cloudflare) |
| **secure-signer** | [`secure-signer`](./secure-signer) | passkey wallet iframe (`signer.revibase.com`) the app registers as “Revibase Passkey” |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `phygix8byCfX2KH1PF7swvwwWTPzf3KmDD7vhAKkNiz` |

## Documentation

Integrator guides (authenticate, check access, and the optional accessory wallet: request permissions, transact) are published on the Revibase developer site.

**Security review:** start with [docs/audit/SCOPE.md](docs/audit/SCOPE.md), then
[ARCHITECTURE](docs/audit/ARCHITECTURE.md) (trust boundaries),
[DESIGN_DECISIONS](docs/audit/DESIGN_DECISIONS.md) (accepted risks) and
[BUILD](docs/audit/BUILD.md) (reproducible builds and deployment).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

| Topic | Read |
|-------|------|
| On-chain program | [README](programs/phygital-token/README.md) (every instruction), [invariants](docs/program/INVARIANTS.md), [threat model](docs/program/THREAT_MODEL.md) |
| Passkey signer | [README](secure-signer/README.md), [threat model](secure-signer/THREAT_MODEL.md), [guarantees and tests](secure-signer/SECURITY.md) |
| App | [setup and testing](app/README.md), [architecture and security boundaries](app/ARCHITECTURE.md), [accessory and wallet UX](docs/wallet-ux.md) |
| Packages | [TypeScript SDK](packages/js/phygital-token/README.md), [Rust CPI client](packages/rust/phygital-token/README.md), [MCP server](packages/mcp/phygital-token/README.md) |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md), [code of conduct](CODE_OF_CONDUCT.md) |

## License

MIT. See [LICENSE](./LICENSE).
