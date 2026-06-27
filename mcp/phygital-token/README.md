# phygital-token MCP Server

Model Context Protocol server for the phygital-token Solana program, TypeScript SDK, and Rust client.

## Gating tools

| Tool | Purpose |
|------|---------|
| `explain_gating` | Mental model, dimensions, flow, pitfalls |
| `gating_filter_schema` | JSON schema for filters, predicates, builders |
| `list_gating_recipes` / `gating_recipe` | Copy-paste patterns and footguns |
| `evaluate_gating` | Full tier evaluation for asset owner |
| `evaluate_gating_filter` | Single filter evaluation |
| `summarize_gating_result` | Human-readable failure reasons |
| `format_gating_predicate` | Format predicate JSON as readable text |
| `list_gating_docs` | All gating doc ids |
| `gating_tier_example` | Example tier JSON |

Gating docs: `gating:overview`, `gating:predicates`, `gating:recipes`, `gating:tiers`, `gating:filters-and-composition`, `gating:evaluation-and-errors`.

## Verification tools

| Tool | Purpose |
|------|---------|
| `recommend_verification` | Pick identification vs authentication vs on-chain pattern |
| `explain_verification` | Decision tree and method reference |
| `plan_verify_asset` | Pattern A (inspect) or B (CPI) planning |

`verifyWithChallengeResponse` accepts optional `message` (off-chain WebAuthn challenge binding). On-chain message binding uses `beginVerifyAsset`.

## Setup

```bash
pnpm install
pnpm --filter phygital-token-sdk build
pnpm --filter phygital-token-mcp build
```

```bash
export PHYGITAL_TOKEN_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
```

Reload MCP servers in Cursor after rebuilding.

## License

ISC
