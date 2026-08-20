#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findTokenPda, parseSecp256r1Pubkey } from "phygital-token-sdk";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "./lib/docs.js";
import { jsonResult, textResult } from "./lib/format.js";
import {
  parseTokenType,
  planInitialize,
  planRemoveOwnership,
  planSetMint,
  planTransfer,
  planVerifyAsset,
} from "./lib/instructions.js";
import { SDK_SURFACE } from "./lib/sdk-surface.js";
import {
  VERIFICATION_DECISION_TREE,
  listVerificationUseCases,
  recommendVerification,
  type VerificationUseCase,
} from "./lib/verification.js";

const VERSION = "0.15.0";

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification method to use → recommend_verification",
  "- On-chain verify (standalone, sysvar inspect, or CPI) → plan_verify_asset",
  "- Initialize / set_mint / transfer / forfeiture → plan_initialize, plan_set_mint, plan_transfer, plan_remove_ownership",
  "- Token PDA from passkey public key → find_asset_pda",
  "- SDK export map → list_sdk_exports",
  "- Anything else → search_docs, then read_doc",
  "",
  "Live token fetch and auth: call phygital-token-sdk directly in your app",
  "(verifyResponse, findTokenPda, beginVerify, etc.).",
].join("\n");

/** Every tool here is offline and side-effect free. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function registerTools(server: McpServer) {
  server.registerTool(
    "search_docs",
    {
      description:
        "Search phygital-token docs (verification, building-on-phygital, SDK surface, glossary). Omit query to list every doc id.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Keyword or natural-language query. Omit to list all docs."),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
      },
      annotations: { title: "Search docs", ...READ_ONLY },
    },
    async ({ query, limit }) => {
      if (!query?.trim()) {
        const docs = await listDocs();
        return jsonResult({
          docs: docs.map(({ id, title, category }) => ({ id, title, category })),
        });
      }
      return jsonResult({ query, results: await searchDocs(query, limit ?? 8) });
    },
  );

  server.registerTool(
    "read_doc",
    {
      description: "Read a full documentation file by id from search_docs results.",
      inputSchema: {
        docId: z
          .string()
          .describe('Document id, e.g. "verification:methods" or "sdk:surface-area"'),
      },
      annotations: { title: "Read doc", ...READ_ONLY },
    },
    async ({ docId }) => textResult(await readDocById(docId)),
  );

  server.registerTool(
    "recommend_verification",
    {
      description:
        "Pick the right SDK auth path (off-chain tap, transfer, or on-chain verify). Omit useCase to get the decision tree and all use cases.",
      inputSchema: {
        useCase: z
          .enum([
            "login_ui_only",
            "transfer_ownership",
            "native_mobile_app",
            "lookup_after_tap",
            "onchain_standalone_verify",
            "onchain_inspect_verify_asset",
            "onchain_cpi_verify_asset",
          ] as [VerificationUseCase, ...VerificationUseCase[]])
          .optional()
          .describe("Omit to list all use cases with the decision tree."),
      },
      annotations: { title: "Recommend verification", ...READ_ONLY },
    },
    async ({ useCase }) =>
      jsonResult(
        useCase
          ? recommendVerification(useCase)
          : {
              decisionTree: VERIFICATION_DECISION_TREE,
              useCases: listVerificationUseCases(),
            },
      ),
  );

  server.registerTool(
    "plan_initialize",
    {
      description:
        "Derive accounts and list signers/inputs for initialize (buildInitializeInstruction).",
      inputSchema: {
        identifier: z
          .string()
          .describe("Base64url chip identifier (binding field; distinct from the passkey)"),
        secp256r1PublicKey: z
          .string()
          .describe("Base64url compressed secp256r1 passkey public key (PDA seed)"),
        tokenType: z.enum(["Controlled", "Bearer"]).describe("Token transfer lock behavior"),
      },
      annotations: { title: "Plan initialize", ...READ_ONLY },
    },
    async ({ identifier, secp256r1PublicKey, tokenType }) =>
      jsonResult(
        await planInitialize({
          identifier,
          secp256r1PublicKey,
          tokenType: parseTokenType(tokenType),
        }),
      ),
  );

  server.registerTool(
    "plan_set_mint",
    {
      description:
        "Derive accounts and list signers/inputs for set_mint (buildSetMintInstruction / buildSquadsSetMintInstructions).",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        mint: z.string().describe("SPL mint address to bind onto token.mint"),
      },
      annotations: { title: "Plan set_mint", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, mint }) =>
      jsonResult(await planSetMint({ secp256r1PublicKey, mint })),
  );

  server.registerTool(
    "plan_transfer",
    {
      description:
        "Plan a passkey-authorized transfer_ownership (offline): flow steps, derived accounts, challenge formula, and required signers.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        recipient: z
          .string()
          .describe("Recipient wallet address — must sign the transfer transaction on-chain"),
      },
      annotations: { title: "Plan transfer", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, recipient }) =>
      jsonResult(await planTransfer({ secp256r1PublicKey, recipient })),
  );

  server.registerTool(
    "plan_verify_asset",
    {
      description:
        "Plan the on-chain verify flow (offline): transaction layout, derived accounts, message binding. standalone = verify only; inspect = Pattern A (your program reads the instructions sysvar); cpi = Pattern B (your program CPIs verify).",
      inputSchema: {
        message: z
          .string()
          .describe(
            "Canonical message string; hashed off-chain to a 32-byte messageHash used as the WebAuthn challenge",
          ),
        secp256r1PublicKey: z
          .string()
          .optional()
          .describe(
            "Optional base64url passkey public key — when set, derives token PDA offline",
          ),
        onChainPattern: z
          .enum(["inspect", "cpi", "standalone"])
          .optional()
          .describe("Composition pattern (default: inspect)"),
      },
      annotations: { title: "Plan verify", ...READ_ONLY },
    },
    async ({ message, secp256r1PublicKey, onChainPattern }) =>
      jsonResult(
        await planVerifyAsset({
          message,
          secp256r1PublicKey,
          onChainPattern,
        }),
      ),
  );

  server.registerTool(
    "plan_remove_ownership",
    {
      description:
        "Plan a wallet-signed forfeiture (offline): reset token.owner to the default pubkey.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        owner: z.string().describe("Current token owner wallet — must match token.owner on-chain"),
      },
      annotations: { title: "Plan remove_ownership", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, owner }) =>
      jsonResult(await planRemoveOwnership({ secp256r1PublicKey, owner })),
  );

  server.registerTool(
    "find_asset_pda",
    {
      description:
        "Derive the on-chain token PDA address from a secp256r1 passkey public key (offline).",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url-encoded secp256r1 passkey public key (PDA seed)"),
      },
      annotations: { title: "Find token PDA", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey }) => {
      const tokenPda = await findTokenPda(parseSecp256r1Pubkey(secp256r1PublicKey));
      return jsonResult({ secp256r1PublicKey, tokenPda });
    },
  );

  server.registerTool(
    "list_sdk_exports",
    {
      description:
        "Map of the phygital-token TypeScript SDK exports and Rust client CPI types, grouped by flow.",
      inputSchema: {},
      annotations: { title: "List SDK exports", ...READ_ONLY },
    },
    async () => jsonResult(SDK_SURFACE),
  );
}

async function main() {
  const server = new McpServer(
    { name: "phygital-token", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server);

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
