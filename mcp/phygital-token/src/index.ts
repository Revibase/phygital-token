#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findPhygitalTokenPda } from "phygital-token-sdk";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "./lib/docs.js";
import { jsonResult, textResult } from "./lib/format.js";
import {
  parseTokenType,
  planAssignMint,
  planCreateConfig,
  planInitialize,
  planRemoveLinkedWallet,
  planTransfer,
  planVerify,
} from "./lib/instructions.js";
import { SDK_SURFACE } from "./lib/sdk-surface.js";
import {
  VERIFICATION_DECISION_TREE,
  listVerificationUseCases,
  recommendVerification,
  type VerificationUseCase,
} from "./lib/verification.js";

const VERSION = "1.3.0";

const SERVER_INSTRUCTIONS = [
  "MCP server for the phygital-token Solana program, TypeScript SDK, and Rust client.",
  "Docs, schema reference, and offline planning only — no live on-chain RPC calls.",
  "",
  "Routing:",
  "- Which verification method to use → recommend_verification",
  "- On-chain verify (your program CPIs verify) → plan_verify",
  "- Admin bootstrap → plan_create_config",
  "- Initialize / assign_mint / transfer / forfeiture → plan_initialize, plan_assign_mint, plan_transfer, plan_remove_linked_wallet",
  "- Token PDA from passkey public key → find_token_pda",
  "- SDK export map → list_sdk_exports",
  "- Anything else → search_docs, then read_doc",
  "",
  "Roles: AdminConfig has one admin, one issuer, one minter (distinct pubkeys).",
  "initialize = issuer only; assign_mint = minter only.",
  "set_linked_wallet requires is_locked == 0 for all token types.",
  "",
  "Live token fetch and auth: call phygital-token-sdk directly in your app",
  "(verifyResponse, findPhygitalTokenPda, buildMessageHash, authenticatePasskeyForSecp256r1Verify({ rpc, messageHash, transceive? }), startAuthentication(message, rpc, { transceive? }), etc.).",
  "All tap helpers share authenticatePasskey: pass { transceive } for native APDU; omit for browser WebAuthn.",
  "Browser WebAuthn taps require Kit Rpc for placeholder credential-id recovery (rawId length 16).",
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
            "set_linked_wallet",
            "native_mobile_app",
            "lookup_after_tap",
            "onchain_cpi_verify",
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
    "plan_create_config",
    {
      description:
        "Plan create_config bootstrap for the singleton AdminConfig (getCreateConfigInstruction).",
      inputSchema: {},
      annotations: { title: "Plan create_config", ...READ_ONLY },
    },
    async () => jsonResult(await planCreateConfig()),
  );

  server.registerTool(
    "plan_initialize",
    {
      description:
        "Derive accounts and list signers/inputs for initialize (getInitializeInstruction). Authority must be AdminConfig.issuer.",
      inputSchema: {
        identifier: z
          .string()
          .describe("Base64url chip identifier (binding field; distinct from the passkey)"),
        secp256r1PublicKey: z
          .string()
          .describe("Base64url compressed secp256r1 passkey public key (PDA seed)"),
        tokenType: z
          .enum(["Permanent", "Controlled", "Bearer"])
          .describe(
            "Token linked-wallet behavior: Permanent (immutable linked wallet), Controlled (lock/forfeit), or Bearer (freely transferable when unlocked)",
          ),
        linkedWallet: z
          .string()
          .describe(
            "Initial phygital_token.linked_wallet (required non-default for Permanent; use the default zero pubkey for unowned Bearer/Controlled tokens). Non-default starts locked.",
          ),
      },
      annotations: { title: "Plan initialize", ...READ_ONLY },
    },
    async ({ identifier, secp256r1PublicKey, tokenType, linkedWallet }) =>
      jsonResult(
        await planInitialize({
          identifier,
          secp256r1PublicKey,
          tokenType: parseTokenType(tokenType),
          linkedWallet,
        }),
      ),
  );

  server.registerTool(
    "plan_assign_mint",
    {
      description:
        "Derive accounts and list signers/inputs for assign_mint (getAssignMintInstruction). Authority must be AdminConfig.minter.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        mint: z.string().describe("SPL mint address to bind onto phygital_token.mint"),
      },
      annotations: { title: "Plan assign_mint", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, mint }) =>
      jsonResult(await planAssignMint({ secp256r1PublicKey, mint })),
  );

  /** @deprecated Prefer plan_assign_mint. Kept for older clients. */
  server.registerTool(
    "plan_set_mint",
    {
      description:
        "Deprecated alias of plan_assign_mint (assign_mint / getAssignMintInstruction).",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        mint: z.string().describe("SPL mint address to bind onto phygital_token.mint"),
      },
      annotations: { title: "Plan assign_mint (alias)", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, mint }) =>
      jsonResult(await planAssignMint({ secp256r1PublicKey, mint })),
  );

  server.registerTool(
    "plan_transfer",
    {
      description:
        "Plan a passkey-authorized set_linked_wallet (offline): flow steps, derived accounts, challenge formula, lock rules, and required signers.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        recipient: z
          .string()
          .describe("Recipient wallet address — must sign the set_linked_wallet transaction on-chain"),
      },
      annotations: { title: "Plan set_linked_wallet", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, recipient }) =>
      jsonResult(await planTransfer({ secp256r1PublicKey, recipient })),
  );

  server.registerTool(
    "plan_verify",
    {
      description:
        "Plan the on-chain verify flow (offline): transaction layout, derived accounts, message binding. Your program CPIs verify; the client prepends secp256r1_verify.",
      inputSchema: {
        message: z
          .string()
          .describe(
            "Message string; hash with buildMessageHash before the tap. Same digest is the WebAuthn challenge and VerifyCpiBuilder.message_hash.",
          ),
        secp256r1PublicKey: z
          .string()
          .optional()
          .describe(
            "Optional base64url passkey public key — when set, derives token PDA offline",
          ),
      },
      annotations: { title: "Plan verify", ...READ_ONLY },
    },
    async ({ message, secp256r1PublicKey }) =>
      jsonResult(
        await planVerify({
          message,
          secp256r1PublicKey,
        }),
      ),
  );

  server.registerTool(
    "plan_remove_linked_wallet",
    {
      description:
        "Plan a wallet-signed forfeiture (offline): reset phygital_token.linked_wallet to the default pubkey and clear is_locked.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        linkedWallet: z
          .string()
          .describe(
            "Current linked wallet — must match phygital_token.linked_wallet on-chain",
          ),
      },
      annotations: { title: "Plan remove_linked_wallet", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, linkedWallet }) =>
      jsonResult(await planRemoveLinkedWallet({ secp256r1PublicKey, linkedWallet })),
  );

  server.registerTool(
    "find_token_pda",
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
      const tokenPda = await findPhygitalTokenPda(secp256r1PublicKey);
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
