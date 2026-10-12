# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

Each token also has a wallet PDA. Its owner can run any instructions as the wallet; the accessory can too, but only within a policy the owner whitelists (blocked by default). See [GLOSSARY.md](./GLOSSARY.md).

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`packages/js/phygital-token`](./packages/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`packages/rust/phygital-token`](./packages/rust/phygital-token) | `phygital-token-client` |
| **phygital-token-mcp** | [`packages/mcp/phygital-token`](./packages/mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **revibase** | [`app`](./app) | tap-to-link web app (SvelteKit on Cloudflare) |
| **secure-signer** | [`secure-signer`](./secure-signer) | passkey wallet iframe (`signer.revibase.com`) the app registers as “Revibase Passkey” |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ` |

## Documentation

Integrator guides (sign in, gate on assets, transact, request permissions) live on the developer site, in the separate `developer` repository.

- [App setup and testing](app/README.md), [architecture and security boundaries](app/ARCHITECTURE.md).
- [Accessory, wallet and custom-action UX](docs/wallet-ux.md).
- [TypeScript SDK](packages/js/phygital-token/README.md), [Rust CPI client](packages/rust/phygital-token/README.md), [MCP server](packages/mcp/phygital-token/README.md).
- [Passkey signer](secure-signer/README.md), [threat model](secure-signer/THREAT_MODEL.md), [security operations](secure-signer/SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
