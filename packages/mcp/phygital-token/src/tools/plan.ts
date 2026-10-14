/** Offline instruction planning: derived accounts, signers and inputs. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findPhygitalTokenPda } from "phygital-token-sdk";
import { z } from "zod";
import { jsonResult } from "../lib/format.js";
import {
  parseTokenType,
  planAssignMint,
  planCreateConfig,
  planInitialize,
  planRemoveOwner,
  planTransfer,
  planVerify,
} from "../lib/instructions.js";
import { READ_ONLY } from "./annotations.js";

export function registerPlanTools(server: McpServer) {
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
            "Token owner behavior: Permanent (immutable owner), Controlled (lock/forfeit), or Bearer (freely transferable when unlocked)",
          ),
        owner: z
          .string()
          .describe(
            "Initial phygital_token.owner (required non-default for Permanent; use the default zero pubkey for unowned Bearer/Controlled tokens). Non-default starts locked.",
          ),
      },
      annotations: { title: "Plan initialize", ...READ_ONLY },
    },
    async ({ identifier, secp256r1PublicKey, tokenType, owner }) =>
      jsonResult(
        await planInitialize({
          identifier,
          secp256r1PublicKey,
          tokenType: parseTokenType(tokenType),
          owner,
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

  server.registerTool(
    "plan_set_mint",
    {
      description: "Deprecated alias of plan_assign_mint (assign_mint / getAssignMintInstruction).",
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
        "Plan a passkey-authorized set_owner (offline): flow steps, derived accounts, challenge formula, lock rules, and required signers.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        recipient: z
          .string()
          .describe("Recipient wallet address — must sign the set_owner transaction on-chain"),
      },
      annotations: { title: "Plan set_owner", ...READ_ONLY },
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
          .describe("Optional base64url passkey public key — when set, derives token PDA offline"),
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
    "plan_remove_owner",
    {
      description:
        "Plan a wallet-signed forfeiture (offline): reset phygital_token.owner to the default pubkey, which unlocks a Controlled token.",
      inputSchema: {
        secp256r1PublicKey: z
          .string()
          .describe("Base64url passkey public key used as the token PDA seed"),
        owner: z.string().describe("Current owner — must match phygital_token.owner on-chain"),
      },
      annotations: { title: "Plan remove_owner", ...READ_ONLY },
    },
    async ({ secp256r1PublicKey, owner }) =>
      jsonResult(await planRemoveOwner({ secp256r1PublicKey, owner })),
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
}
