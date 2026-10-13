#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

const { version: VERSION } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification method to use → recommend_verification",
  "- Admin bootstrap → plan_create_config",
  "- Initialize / assign_mint / transfer / forfeiture → plan_initialize, plan_assign_mint, plan_transfer, plan_remove_owner",
  "- Token PDA from passkey public key → find_token_pda",
  "- SDK export map → list_sdk_exports",
  "- Anything else → search_docs, then read_doc",
  "",
  "Roles: AdminConfig has one admin, one issuer, one minter (distinct pubkeys).",
  "initialize = issuer only; assign_mint = minter only.",
  "set_owner requires an unlocked token: Controlled and Permanent are locked whenever they have an owner (isPhygitalTokenLocked).",
  "",
  "Live token fetch and auth: call phygital-token-sdk directly in your app",
  "(startAuthentication, verifyResponse, findPhygitalTokenPda, etc.).",
  "All tap helpers share authenticatePasskey, which prompts browser WebAuthn.",
  "Browser WebAuthn taps require Kit Rpc for placeholder credential-id recovery (rawId length 16).",
].join("\n");

async function main() {
  const server = new McpServer(
    { name: "phygital-token", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
