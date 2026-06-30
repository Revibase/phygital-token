#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  findAssetPda,
  formatGatingPredicate,
  parseSecp256r1Pubkey,
  summarizeGatingEvaluationFailure,
  summarizeGatingFailure,
} from "phygital-token-sdk";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "./lib/docs.js";
import { jsonResult, textResult } from "./lib/format.js";
import {
  GATING_FILTER_SCHEMA,
  GATING_OVERVIEW,
  GATING_RECIPES,
  GATING_TIER_EXAMPLE,
  getGatingRecipe,
} from "./lib/gating-json.js";
import { runGraphify } from "./lib/graphify.js";
import {
  parseAssetType,
  planCreateMint,
  planMintToken,
  planRemoveOwnership,
  planTransfer,
  planVerifyAsset,
} from "./lib/instructions.js";
import { SDK_SURFACE, readSourceExcerpt } from "./lib/sdk-surface.js";
import {
  ON_CHAIN_PATTERNS,
  VERIFICATION_DECISION_TREE,
  listVerificationUseCases,
  recommendVerification,
  type VerificationUseCase,
} from "./lib/verification.js";

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification to use → recommend_verification or explain_verification",
  "- Composable verify_asset → plan_verify_asset, read_doc verify-asset-composable",
  "- Building on phygital (CPI) → read_doc building-on-phygital/*, rust_cpi_verify_asset_guide",
  "- SDK export map → list_sdk_exports",
  "- Gating rules → explain_gating, gating_filter_schema, gating_recipe, format_gating_predicate",
  "- Mint / transfer / forfeiture flows → plan_create_mint, plan_mint_token, plan_transfer, plan_remove_ownership",
  "- Code architecture (repo clone) → query_codebase (graphify)",
  "",
  "Live gating evaluation and asset fetch: use phygital-token-sdk in your app (evaluateAssetGating, fetchAssetDisplayInfo).",
  "query_codebase and read_sdk_source need PHYGITAL_TOKEN_REPO_ROOT when not running from a clone.",
].join("\n");

function registerTools(server: McpServer) {
  server.tool(
    "search_docs",
    "Search phygital-token docs: gating, verification, building-on-phygital, SDK surface, glossary.",
    {
      query: z.string().describe("Natural-language or keyword search query"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
    },
    async ({ query, limit }) => {
      const results = await searchDocs(query, limit ?? 8);
      return jsonResult({ query, results });
    },
  );

  server.tool(
    "read_doc",
    "Read a full documentation file by id from search_docs results.",
    {
      docId: z.string().describe('Document id, e.g. "gating:overview" or "verification:overview"'),
    },
    async ({ docId }) => textResult(await readDocById(docId)),
  );

  server.tool(
    "list_docs",
    "List all available phygital-token documentation resources.",
    {},
    async () => jsonResult({ docs: await listDocs() }),
  );

  server.tool(
    "query_codebase",
    "Query the phygital-token knowledge graph via graphify (architecture, call paths, concepts). Requires a repo clone.",
    {
      question: z.string().describe("Natural-language question about the codebase"),
      mode: z
        .enum(["query", "explain", "path"])
        .optional()
        .describe("query=BFS context (default), explain=concept summary, path=shortest path between two nodes"),
      from: z.string().optional().describe('Required for mode=path: start concept/node name'),
      to: z.string().optional().describe('Required for mode=path: end concept/node name'),
    },
    async ({ question, mode = "query", from, to }) => {
      if (mode === "path") {
        if (!from || !to) {
          throw new Error('mode "path" requires both from and to.');
        }
        const output = await runGraphify("path", [from, to]);
        return textResult(output);
      }

      if (mode === "explain") {
        const output = await runGraphify("explain", [question]);
        return textResult(output);
      }

      const output = await runGraphify("query", [question]);
      return textResult(output);
    },
  );

  server.tool(
    "find_asset_pda",
    "Derive the on-chain asset PDA address from a secp256r1 passkey public key (offline).",
    {
      assetPublicKey: z
        .string()
        .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
    },
    async ({ assetPublicKey }) => {
      const pubkey = parseSecp256r1Pubkey(assetPublicKey);
      const assetPda = await findAssetPda(pubkey);
      return jsonResult({ assetPublicKey, assetPda });
    },
  );

  server.tool(
    "gating_tier_example",
    "Return a copy-paste JSON example for evaluateAssetGating tier configuration.",
    {},
    async () => jsonResult({ tiers: GATING_TIER_EXAMPLE }),
  );

  server.tool(
    "explain_gating",
    "Gating mental model: dimensions, flow, aggregations, same-asset vs wallet pitfalls, doc index.",
    {},
    async () => jsonResult(GATING_OVERVIEW),
  );

  server.tool(
    "gating_filter_schema",
    "JSON schema reference for GatingFilter trees, predicates, traits, and SDK builders.",
    {},
    async () => jsonResult(GATING_FILTER_SCHEMA),
  );

  server.tool(
    "list_gating_recipes",
    "List copy-paste gating recipes (filters, tiers, and common footguns).",
    {
      includeFootguns: z
        .boolean()
        .optional()
        .describe("Include anti-pattern / footgun recipes (default true)"),
    },
    async ({ includeFootguns = true }) =>
      jsonResult({
        recipes: GATING_RECIPES.filter((r) => includeFootguns || !r.footgun).map(
          ({ id, title, description, footgun }) => ({
            id,
            title,
            description,
            footgun: footgun ?? false,
          }),
        ),
      }),
  );

  server.tool(
    "gating_recipe",
    "Return a gating recipe by id (JSON filter or tiers for evaluateAssetGating).",
    {
      recipeId: z.string().describe("Recipe id from list_gating_recipes"),
    },
    async ({ recipeId }) => jsonResult(getGatingRecipe(recipeId)),
  );

  server.tool(
    "summarize_gating_result",
    "Human-readable failure reasons from evaluateAssetGating output (pass the SDK result JSON).",
    {
      evaluationJson: z.unknown().describe("JSON result from evaluateAssetGating"),
    },
    async ({ evaluationJson }) => {
      const data = evaluationJson as Record<string, unknown>;
      if (data.failureSummary && Array.isArray(data.failureSummary)) {
        return jsonResult({ summary: data.failureSummary });
      }
      if (data.tiers && Array.isArray(data.tiers)) {
        const summary = summarizeGatingEvaluationFailure(
          data as Parameters<typeof summarizeGatingEvaluationFailure>[0],
        );
        return jsonResult({ summary });
      }
      if (data.filterResult) {
        return jsonResult({
          summary: summarizeGatingFailure(
            data.filterResult as Parameters<typeof summarizeGatingFailure>[0],
          ),
        });
      }
      throw new Error(
        "Unrecognized evaluation JSON. Pass output from evaluateAssetGating in your app.",
      );
    },
  );

  server.tool(
    "format_gating_predicate",
    "Format a GatingAssetPredicate JSON object as a human-readable string.",
    {
      predicate: z.unknown().describe("GatingAssetPredicate JSON"),
    },
    async ({ predicate }) => {
      if (!predicate || typeof predicate !== "object") {
        throw new Error("predicate must be a JSON object");
      }
      return jsonResult({
        formatted: formatGatingPredicate(
          predicate as Parameters<typeof formatGatingPredicate>[0],
        ),
      });
    },
  );

  server.tool(
    "list_gating_docs",
    "List all gating documentation doc ids (overview, predicates, recipes, etc.).",
    {},
    async () => {
      const docs = await listDocs();
      return jsonResult({
        docs: docs.filter((d) => d.category === "gating"),
      });
    },
  );

  server.tool(
    "plan_create_mint",
    "Validate metadata and return accounts/signers needed for create_mint (buildCreateMintInstructions).",
    {
      name: z.string().describe("Token metadata name (max 32 chars)"),
      symbol: z.string().describe("Token metadata symbol (max 10 chars)"),
      uri: z.string().describe("Metadata URI (max 200 chars)"),
    },
    async ({ name, symbol, uri }) => jsonResult(planCreateMint({ name, symbol, uri })),
  );

  server.tool(
    "plan_mint_token",
    "Derive accounts and list signers/inputs for mint_token (buildMintTokenInstructions).",
    {
      assetPublicKey: z
        .string()
        .describe("Base64url-encoded secp256r1 public key for the new asset"),
      mint: z.string().describe("Design mint address"),
      assetType: z
        .enum(["Lockable", "Transferable"])
        .describe("Asset transfer lock behavior"),
      credentialId: z
        .string()
        .optional()
        .describe("Base64url passkey credential id (for reference in plan output)"),
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

  server.tool(
    "plan_remove_ownership",
    "Plan a wallet-signed forfeiture: return token to custody and reset asset.owner (offline).",
    {
      assetPublicKey: z
        .string()
        .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
      owner: z
        .string()
        .describe("Current asset owner wallet — must match asset.owner on-chain"),
      mint: z.string().describe("Design mint address for the asset"),
    },
    async ({ assetPublicKey, owner, mint }) =>
      jsonResult(
        await planRemoveOwnership({ assetPublicKey, owner, mint }),
      ),
  );

  server.tool(
    "plan_transfer",
    "Plan a passkey-authorized transfer: flow steps, derived accounts, and challenge formula (offline).",
    {
      assetPublicKey: z
        .string()
        .describe("Base64url-encoded secp256r1 public key for the phygital asset"),
      recipient: z.string().describe("Recipient wallet address"),
      mint: z
        .string()
        .optional()
        .describe("Design mint address — enables ATA derivation when combined with currentOwner"),
      currentOwner: z
        .string()
        .optional()
        .describe("Current asset owner wallet — enables ATA derivation when combined with mint"),
    },
    async ({ assetPublicKey, recipient, mint, currentOwner }) =>
      jsonResult(
        await planTransfer({ assetPublicKey, recipient, mint, currentOwner }),
      ),
  );

  server.tool(
    "recommend_verification",
    "Recommend which SDK verification method to use for a specific use case (identification vs authentication).",
    {
      useCase: z.enum([
        "product_page_lookup",
        "deep_link_from_prior_scan",
        "offline_identification",
        "login_ui_only",
        "vault_gated_experience",
        "onchain_standalone_verify",
        "onchain_inspect_verify_asset",
        "onchain_cpi_verify_asset",
        "transfer_ownership",
        "wallet_holdings_gate",
        "native_mobile_app",
      ] as [VerificationUseCase, ...VerificationUseCase[]]),
    },
    async ({ useCase }) => jsonResult(recommendVerification(useCase)),
  );

  server.tool(
    "list_verification_use_cases",
    "List all supported verification use cases for recommend_verification.",
    {},
    async () =>
      jsonResult({
        useCases: listVerificationUseCases(),
        decisionTree: VERIFICATION_DECISION_TREE,
      }),
  );

  server.tool(
    "explain_verification",
    "Explain identification vs authentication and all verify.ts methods. Returns decision tree + doc pointers.",
    {},
    async () =>
      jsonResult({
        decisionTree: VERIFICATION_DECISION_TREE,
        useCases: listVerificationUseCases(),
        onChainPatterns: ON_CHAIN_PATTERNS,
        methods: {
          identification: ["verifyDynamicUrl", "verifyDynamicUrlWithoutCounterCheck"],
          authenticationOffChain: [
            "startAuthenticationWithChallengeResponse",
            "verifyWithChallengeResponse",
          ],
          onChainComposable: [
            "beginVerifyAsset",
            "buildVerifyAssetArgs",
            "completeVerifyAsset",
          ],
          transfer: ["beginTransfer", "completeTransfer"],
        },
        docIds: [
          "verification:overview",
          "verification:methods",
          "verification:verify-asset-composable",
          "building-on-phygital:overview",
        ],
      }),
  );

  server.tool(
    "plan_verify_asset",
    "Plan on-chain verify_asset flow (offline). Pattern A: client posts verify_asset. Pattern B: program CPIs.",
    {
      message: z
        .string()
        .describe(
          "UTF-8 message bytes bound into the on-chain proof (embed domain-specific payload for your program)",
        ),
      onChainPattern: z
        .enum(["inspect", "cpi", "standalone"])
        .optional()
        .describe(
          "inspect = Pattern A. cpi = Pattern B. standalone = verify_asset only.",
        ),
      assetPublicKey: z
        .string()
        .optional()
        .describe("Optional base64url secp256r1 pubkey to pre-derive asset PDA"),
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

  server.tool(
    "list_sdk_exports",
    "List all major phygital-token TypeScript SDK exports and Rust client CPI types.",
    {},
    async () => jsonResult(SDK_SURFACE),
  );

  server.tool(
    "read_sdk_source",
    "Read an excerpt from key SDK source files (requires PHYGITAL_TOKEN_REPO_ROOT or monorepo clone).",
    {
      file: z.enum(["verify.ts", "verifyAsset.ts", "rust_verify_asset.rs"]),
      maxLines: z.number().int().min(20).max(300).optional(),
    },
    async ({ file, maxLines }) => jsonResult(await readSourceExcerpt(file, maxLines ?? 120)),
  );

  server.tool(
    "rust_cpi_verify_asset_guide",
    "Guide for building on verify_asset: Pattern A (inspect sysvar) or Pattern B (CPI) using phygital-token-client.",
    {
      pattern: z
        .enum(["inspect", "cpi"])
        .optional()
        .describe("inspect = Pattern A. cpi = Pattern B."),
    },
    async ({ pattern = "inspect" }) =>
      jsonResult({
        pattern,
        ...(pattern === "inspect" ? ON_CHAIN_PATTERNS.inspect : ON_CHAIN_PATTERNS.cpi),
        rustCrate: "phygital-token-client",
        path: "clients/rust/phygital-token",
        dependency: 'phygital-token-client = { version = "0.1", features = ["anchor"] }',
        cpiTypes: ["VerifyAssetCpiBuilder", "VerifyAssetInstructionArgs", "Secp256r1VerifyArgs"],
        clientTypeScript:
          pattern === "inspect"
            ? ["beginVerifyAsset", "completeVerifyAsset", "getVerifyAssetInstruction"]
            : ["beginVerifyAsset", "buildVerifyAssetArgs"],
        messageBinding:
          "Client and your program must agree on exact message bytes passed to beginVerifyAsset",
        referenceImplementation:
          pattern === "inspect"
            ? "programs/phygital-spend — require_matching_verify_asset"
            : "clients/rust/phygital-token — VerifyAssetCpiBuilder",
        docIds: ["building-on-phygital:overview", "building-on-phygital:rust-cpi"],
        testing: "programs/phygital-token/tests/verify_asset_flow.rs",
        note: "Off-chain tap: startAuthenticationWithChallengeResponse (client) + verifyWithChallengeResponse (server, expectedMessage + response). On-chain message binding uses beginVerifyAsset.",
      }),
  );
}

function registerResources(server: McpServer) {
  server.resource(
    "verification-overview",
    "phygital://docs/verification/overview",
    {
      description: "Identification vs authentication — when to use which verification method",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/verification/overview",
          mimeType: "text/markdown",
          text: await readDocById("verification:overview"),
        },
      ],
    }),
  );

  server.resource(
    "verify-asset-composable",
    "phygital://docs/verification/verify-asset-composable",
    {
      description: "Composable verify_asset flow — buildVerifyAssetArgs and transaction layout",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/verification/verify-asset-composable",
          mimeType: "text/markdown",
          text: await readDocById("verification:verify-asset-composable"),
        },
      ],
    }),
  );

  server.resource(
    "building-on-phygital",
    "phygital://docs/building-on-phygital/overview",
    {
      description: "Guide for third-party developers building on phygital assets",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/building-on-phygital/overview",
          mimeType: "text/markdown",
          text: await readDocById("building-on-phygital:overview"),
        },
      ],
    }),
  );

  server.resource(
    "gating-overview",
    "phygital://docs/gating/overview",
    {
      description: "Gating overview — mental model, dimensions, and tier evaluation flow",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/gating/overview",
          mimeType: "text/markdown",
          text: await readDocById("gating:overview"),
        },
      ],
    }),
  );

  server.resource(
    "gating-recipes",
    "phygital://docs/gating/recipes",
    {
      description: "Gating copy-paste recipes and footguns",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/gating/recipes",
          mimeType: "text/markdown",
          text: await readDocById("gating:recipes"),
        },
      ],
    }),
  );

  server.resource(
    "gating-predicates",
    "phygital://docs/gating/predicates",
    {
      description: "Gating predicates — collection, mint, traits, balance operators",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/gating/predicates",
          mimeType: "text/markdown",
          text: await readDocById("gating:predicates"),
        },
      ],
    }),
  );

  server.resource(
    "gating-evaluation",
    "phygital://docs/gating/evaluation-and-errors",
    {
      description: "Gating evaluation results and debugging failures",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://docs/gating/evaluation-and-errors",
          mimeType: "text/markdown",
          text: await readDocById("gating:evaluation-and-errors"),
        },
      ],
    }),
  );

  server.resource(
    "glossary",
    "phygital://glossary",
    {
      description: "Phygital Token domain glossary (collection, design, asset, custody)",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "phygital://glossary",
          mimeType: "text/markdown",
          text: await readDocById("glossary"),
        },
      ],
    }),
  );
}

function registerPrompts(server: McpServer) {
  server.prompt(
    "choose_verification_method",
    "Help pick the right phygital verification approach for a product requirement",
    {
      requirement: z
        .string()
        .describe("What you are trying to accomplish (e.g. unlock VIP door, product page, custom spend program)"),
      needsOnChainProof: z.boolean().optional(),
      onChainPattern: z.enum(["inspect", "cpi"]).optional(),
      isNativeApp: z.boolean().optional(),
      hasPriorScanUrl: z.boolean().optional(),
    },
    async ({ requirement, needsOnChainProof, onChainPattern, isNativeApp, hasPriorScanUrl }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Choose the right phygital-token verification method for:",
              requirement,
              needsOnChainProof != null ? `Needs on-chain proof: ${needsOnChainProof}` : "",
              onChainPattern ? `On-chain pattern: ${onChainPattern}` : "",
              isNativeApp != null ? `Native app: ${isNativeApp}` : "",
              hasPriorScanUrl != null ? `Has prior scan URL params: ${hasPriorScanUrl}` : "",
              "",
              "Off-chain tap: startAuthenticationWithChallengeResponse (client) + verifyWithChallengeResponse (server). No verify_asset tx.",
              "On-chain: Pattern A = client posts verify_asset, program inspects sysvar.",
              "On-chain: Pattern B = buildVerifyAssetArgs, program CPIs verify_asset.",
              "Use recommend_verification, explain_verification, plan_verify_asset.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "build_composable_verify_asset_tx",
    "Design a composable transaction with verify_asset for a custom program",
    {
      programAction: z.string().describe("What your program does after verify_asset (spend, unlock, claim, etc.)"),
      onChainPattern: z
        .enum(["inspect", "cpi"])
        .describe("inspect = client posts verify_asset; cpi = program CPIs verify_asset"),
      messageFormat: z.string().optional().describe("Proposed message byte format to bind authorization"),
    },
    async ({ programAction, onChainPattern, messageFormat }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Design a Pattern ${onChainPattern === "inspect" ? "A" : "B"} verify_asset transaction for:`,
              programAction,
              messageFormat ? `Message format: ${messageFormat}` : "",
              "",
              onChainPattern === "inspect"
                ? "Pattern A: completeVerifyAsset + your ix; program inspects instructions sysvar."
                : "Pattern B: buildVerifyAssetArgs + your ix; program CPIs verify_asset.",
              "Use plan_verify_asset and read_doc building-on-phygital/rust-cpi.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "design_gating_tiers",
    "Help design wallet gating tiers for a phygital experience",
    {
      experience: z.string().describe("What you are gating (e.g. VIP lounge, premium content)"),
      collections: z
        .string()
        .optional()
        .describe("Collection mint addresses or descriptions"),
      traits: z.string().optional().describe("NFT traits to consider"),
    },
    async ({ experience, collections, traits }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Design phygital-token gating tiers for this experience:",
              experience,
              collections ? `Collections: ${collections}` : "",
              traits ? `Traits: ${traits}` : "",
              "",
              "Use the Gating filter tree (count, totalBalance, and/or/not).",
              "Search docs with search_docs and return:",
              "1) recommended tier ids",
              "2) JSON tiers array for evaluateAssetGating in the SDK",
              "3) pitfalls (same asset vs same wallet)",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.prompt(
    "debug_gating_failure",
    "Explain why a gating evaluation failed and how to fix it",
    {
      evaluationJson: z
        .string()
        .describe("JSON output from evaluateAssetGating or failureSummary field"),
    },
    async ({ evaluationJson }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Debug this phygital-token gating evaluation failure:",
              evaluationJson,
              "",
              "Use search_docs on evaluation-and-errors and recipes.",
              "Explain root cause in plain language and suggest a corrected filter tree.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

async function main() {
  const server = new McpServer(
    {
      name: "phygital-token",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
