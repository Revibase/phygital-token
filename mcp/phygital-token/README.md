# phygital-token MCP Server

[Model Context Protocol](https://modelcontextprotocol.io) server for the phygital-token Solana program, TypeScript SDK, and Rust client.

**Docs, schema reference, and offline planning only** — no live RPC or on-chain calls. Use [`phygital-token-sdk`](https://www.npmjs.com/package/phygital-token-sdk) in your app for `evaluateAssetGating`, `fetchAssetDisplayInfo`, and transaction building.

## Install

Add to Cursor MCP config (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

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
| **Docs** | `search_docs`, `read_doc`, `list_docs` |
| **Gating** | `explain_gating`, `gating_filter_schema`, `gating_recipe`, `format_gating_predicate`, `summarize_gating_result` |
| **Verification** | `recommend_verification`, `plan_verify_asset`, `explain_verification` |
| **Planning** | `plan_create_mint`, `plan_mint_token`, `plan_transfer`, `plan_remove_ownership`, `find_asset_pda` |
| **SDK** | `list_sdk_exports` |

## Optional: monorepo contributors

```bash
pnpm install
pnpm --filter phygital-token-sdk build
pnpm --filter phygital-token-mcp build
```

**Contributor-only** (repo clone + `PHYGITAL_TOKEN_REPO_ROOT`):

| Tool | Requires |
|------|----------|
| `query_codebase` | `graphify` CLI + `graphify update .` in the repo |
| `read_sdk_source` | Cloned repo or `PHYGITAL_TOKEN_REPO_ROOT` |

## Publish

```bash
cd mcp/phygital-token
pnpm build
npm publish --access public
```

## License

ISC
