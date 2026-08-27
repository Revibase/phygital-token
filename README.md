# phygital-token

Solana program, TypeScript SDK, Rust CPI client, and MCP server for phygital tokens authenticated with a live NFC / WebAuthn tap.

## Packages

| Package | Path | Install |
|---------|------|---------|
| **phygital-token-sdk** | [`clients/js/phygital-token`](./clients/js/phygital-token) | `pnpm add phygital-token-sdk @solana/kit` |
| **phygital-token-client** | [`clients/rust/phygital-token`](./clients/rust/phygital-token) | `phygital-token-client = "1.0"` |
| **phygital-token-mcp** | [`mcp/phygital-token`](./mcp/phygital-token) | `npx -y phygital-token-mcp` |
| **phygital-token** (on-chain) | [`programs/phygital-token`](./programs/phygital-token) | program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ` |

## License

MIT. See [LICENSE](./LICENSE).
