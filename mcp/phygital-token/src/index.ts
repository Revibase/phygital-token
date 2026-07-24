#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findAssetPda, parseSecp256r1Pubkey } from "phygital-token-sdk";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "./lib/docs.js";
import { jsonResult, textResult } from "./lib/format.js";
import {
  parseAssetType,
  planCreateMint,
  planMintToken,
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

const VERSION = "0.4.0";

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification method to use → recommend_verification",
  "- On-chain verify_asset (standalone, sysvar inspect, or CPI) → plan_verify_asset",
  "- Mint / transfer / forfeiture flows → plan_create_mint, plan_mint_token, plan_transfer, plan_remove_ownership",
  "- SDK export map → list_sdk_exports",
  "- Anything else → search_docs, then read_doc",
  "",
  "Live asset fetch and auth: call phygital-token-sdk directly in your app",
  "(verifyResponse, fetchAssetDisplayInfo, etc.).",
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
        "Pick the right SDK verification method (identification vs authentication, off-chain vs on-chain). Omit useCase to get the decision tree and all use cases.",
      inputSchema: {
        useCase: z
          .enum([
            "product_page_lookup",
            "deep_link_from_prior_scan",
            "offline_identification",
            "login_ui_only",
            "onchain_standalone_verify",
            "onchain_inspect_verify_asset",
            "onchain_cpi_verify_asset",
            "transfer_ownership",
            "native_mobile_app",
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
    "plan_verify_asset",
    {
      description:
        "Plan the on-chain verify_asset flow (offline): transaction layout, derived accounts, message binding. standalone = verify_asset only; inspect = Pattern A (your program reads the instructions sysvar); cpi = Pattern B (your program CPIs verify_asset).",
      inputSchema: {
        message: z
          .string()
          .describe(
            "UTF-8 message bytes bound into the on-chain proof (embed your domain-specific payload)",
          ),
        onChainPattern: z
          .enum(["inspect", "cpi", "standalone"])
          .optional()
          .describe("Default inspect (Pattern A)."),
        assetPublicKey: z
          .string()
          .optional()
          .describe("Base64url secp256r1 pubkey, to pre-derive the asset PDA"),
      },
      annotations: { title: "Plan verify_asset", ...READ_ONLY },
    },
    async ({ message, onChainPattern, assetPublicKey }) =>
      jsonResult(
        await planVerifyAsset({
          message,
          assetPublicKey,
          onChainPattern: onChainPattern ?? "inspect",
        }),
      ),
  );

  server.registerTool(
    "plan_create_mint",
    {
      description:
        "Validate design metadata and return the accounts/signers for create_mint (buildCreateMintInstructions).",
      inputSchema: {
        name: z.string().describe("Token metadata name (max 32 chars)"),
        symbol: z.string().describe("Token metadata symbol (max 10 chars)"),
        uri: z.string().describe("Metadata URI (max 200 chars)"),
      },
      annotations: { title: "Plan create_mint", ...READ_ONLY },
    },
    async ({ name, symbol, uri }) => jsonResult(planCreateMint({ name, symbol, uri })),
  );

  server.registerTool(
    "plan_mint_token",
    {
      description:
        "Derive accounts and list signers/inputs for mint_token (buildMintTokenInstructions).",
      inputSchema: {
        assetPublicKey: z
          .string()
          .describe("Base64url-encoded secp256r1 public key for the new asset"),
        mint: z.string().describe("Design mint address"),
        assetType: z.enum(["Lockable", "Transferable"]).describe("Asset transfer lock behavior"),
        credentialId: z
          .string()
          .optional()
          .describe("Base64url passkey credential id (echoed in the plan output)"),
      },
      annotations: { title: "Plan mint_token", ...READ_ONLY },
    },
    async ({ assetPublicKey, mint, assetType, credentialId }) =>
      jsonResult(
        await planMintToken({
          assetPublicKey,
          mint,
          assetType: parseAssetType(assetType),
          credentialId,
        }),
      ),
  );

  server.registerTool(
    "plan_transfer",
    {
      description:
        "Plan a passkey-authorized transfer (offline): flow steps, derived accounts, and challenge formula.",
      inputSchema: {
        assetPublicKey: z
          .string()
          .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
        recipient: z.string().describe("Recipient wallet address"),
        mint: z
          .string()
          .optional()
          .describe("Design mint address — with currentOwner, enables ATA derivation"),
        currentOwner: z
          .string()
          .optional()
          .describe("Current asset owner wallet — with mint, enables ATA derivation"),
      },
      annotations: { title: "Plan transfer", ...READ_ONLY },
    },
    async ({ assetPublicKey, recipient, mint, currentOwner }) =>
      jsonResult(await planTransfer({ assetPublicKey, recipient, mint, currentOwner })),
  );

  server.registerTool(
    "plan_remove_ownership",
    {
      description:
        "Plan a wallet-signed forfeiture (offline): return the token to custody and reset asset.owner.",
      inputSchema: {
        assetPublicKey: z
          .string()
          .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
        owner: z.string().describe("Current asset owner wallet — must match asset.owner on-chain"),
        mint: z.string().describe("Design mint address for the asset"),
      },
      annotations: { title: "Plan remove_ownership", ...READ_ONLY },
    },
    async ({ assetPublicKey, owner, mint }) =>
      jsonResult(await planRemoveOwnership({ assetPublicKey, owner, mint })),
  );

  server.registerTool(
    "find_asset_pda",
    {
      description:
        "Derive the on-chain asset PDA address from a secp256r1 passkey public key (offline).",
      inputSchema: {
        assetPublicKey: z
          .string()
          .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
      },
      annotations: { title: "Find asset PDA", ...READ_ONLY },
    },
    async ({ assetPublicKey }) => {
      const assetPda = await findAssetPda(parseSecp256r1Pubkey(assetPublicKey));
      return jsonResult({ assetPublicKey, assetPda });
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
