# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`packages/js/phygital-token`](./packages/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`packages/rust/phygital-token`](./packages/rust/phygital-token) | `phygital-token-client = "1.1"` |
| **phygital-token-mcp** | [`mcp/phygital-token`](./mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ` |

## License

MIT. See [LICENSE](./LICENSE).
