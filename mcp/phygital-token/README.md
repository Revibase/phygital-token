# phygital-token MCP Server

[Model Context Protocol](https://modelcontextprotocol.io) server for the phygital-token Solana program, TypeScript SDK, and Rust client.

**Docs, schema reference, and offline planning only** — no live RPC or on-chain calls. Use [`phygital-token-sdk`](https://www.npmjs.com/package/phygital-token-sdk) in your app for `evaluateAssetGating`, `fetchAssetDisplayInfo`, and transaction building.

## Install

Add to your MCP client config (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "phygital-token": {
      "command": "npx",
      "args": ["-y", "phygital-token-mcp"]
    }
  }
}
```

Requires **Node.js 20+**. See [`cursor-mcp.example.json`](./cursor-mcp.example.json).

## Tools

| Area | Tools |
|------|-------|
| **Docs** | `search_docs` (omit query to list all), `read_doc` |
| **Verification** | `recommend_verification` (omit useCase for the decision tree), `plan_verify_asset` |
| **Planning** | `plan_create_mint`, `plan_mint_token`, `plan_transfer`, `plan_remove_ownership`, `find_asset_pda` |
| **Gating** | `explain_gating`, `gating_recipe` (omit id to list) |
| **SDK** | `list_sdk_exports` |

All tools are offline and read-only.

## Develop

```bash
pnpm install
pnpm --filter phygital-token-sdk build
pnpm --filter phygital-token-mcp build
```

The SDK is consumed via `workspace:*`, so the server always builds against the in-repo SDK.

## Publish

`workspace:*` is rewritten to the SDK's published version at pack time, so publish with pnpm:

```bash
pnpm --filter phygital-token-mcp build
pnpm --filter phygital-token-mcp publish --access public
```

## License

ISC
