#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findAssetPda, parseSecp256r1Pubkey } from "phygital-token-sdk";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "./lib/docs.js";
import { jsonResult, textResult } from "./lib/format.js";
import {
  parseAssetType,
  planInitialize,
  planRemoveOwnership,
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

const VERSION = "0.8.0";

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification method to use → recommend_verification",
  "- On-chain verify_asset (standalone, sysvar inspect, or CPI) → plan_verify_asset",
  "- Initialize / transfer / forfeiture → plan_initialize, plan_transfer, plan_remove_ownership",
  "- Asset PDA from chip identifier → find_asset_pda",
  "- SDK export map → list_sdk_exports",
  "- Anything else → search_docs, then read_doc",
  "",
  "Live asset fetch and auth: call phygital-token-sdk directly in your app",
  "(verifyResponse, fetchAssetsByPublicKey, findAssetPda, beginVerifyAsset, etc.).",
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
        "Pick the right SDK auth path (off-chain tap, transfer, or on-chain verify_asset). Omit useCase to get the decision tree and all use cases.",
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
          .describe("Base64url chip identifier (PDA seed; distinct from the passkey)"),
        secp256r1PublicKey: z
          .string()
          .describe("Base64url compressed secp256r1 passkey public key"),
        assetType: z.enum(["Lockable", "Transferable"]).describe("Asset transfer lock behavior"),
      },
      annotations: { title: "Plan initialize", ...READ_ONLY },
    },
    async ({ identifier, secp256r1PublicKey, assetType }) =>
      jsonResult(
        await planInitialize({
          identifier,
          secp256r1PublicKey,
          assetType: parseAssetType(assetType),
        }),
      ),
  );

  server.registerTool(
    "plan_transfer",
    {
      description:
        "Plan a passkey-authorized transfer (offline): flow steps, derived accounts, and challenge formula.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Base64url chip identifier used as the asset PDA seed"),
        recipient: z.string().describe("Recipient wallet address"),
      },
      annotations: { title: "Plan transfer", ...READ_ONLY },
    },
    async ({ identifier, recipient }) =>
      jsonResult(await planTransfer({ identifier, recipient })),
  );

  server.registerTool(
    "plan_verify_asset",
    {
      description:
        "Plan the on-chain verify_asset flow (offline): transaction layout, derived accounts, message binding. standalone = verify_asset only; inspect = Pattern A (your program reads the instructions sysvar); cpi = Pattern B (your program CPIs verify_asset).",
      inputSchema: {
        message: z.string().describe("UTF-8 message bytes bound into the verify_asset challenge"),
        identifier: z
          .string()
          .optional()
          .describe(
            "Optional base64url chip identifier — when set, derives asset PDA offline",
          ),
        onChainPattern: z
          .enum(["inspect", "cpi", "standalone"])
          .optional()
          .describe("Composition pattern (default: inspect)"),
      },
      annotations: { title: "Plan verify_asset", ...READ_ONLY },
    },
    async ({ message, identifier, onChainPattern }) =>
      jsonResult(
        await planVerifyAsset({
          message,
          identifier,
          onChainPattern,
        }),
      ),
  );

  server.registerTool(
    "plan_remove_ownership",
    {
      description:
        "Plan a wallet-signed forfeiture (offline): reset asset.owner to the default pubkey.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Base64url chip identifier used as the asset PDA seed"),
        owner: z.string().describe("Current asset owner wallet — must match asset.owner on-chain"),
      },
      annotations: { title: "Plan remove_ownership", ...READ_ONLY },
    },
    async ({ identifier, owner }) =>
      jsonResult(await planRemoveOwnership({ identifier, owner })),
  );

  server.registerTool(
    "find_asset_pda",
    {
      description:
        "Derive the on-chain asset PDA address from a chip identifier (offline).",
      inputSchema: {
        identifier: z
          .string()
          .describe("Base64url-encoded chip identifier (PDA seed)"),
      },
      annotations: { title: "Find asset PDA", ...READ_ONLY },
    },
    async ({ identifier }) => {
      const assetPda = await findAssetPda(parseSecp256r1Pubkey(identifier));
      return jsonResult({ identifier, assetPda });
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
