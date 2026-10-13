/** Choosing a verification method. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult } from "../lib/format.js";
import {
  VERIFICATION_DECISION_TREE,
  listVerificationUseCases,
  recommendVerification,
  type VerificationUseCase,
} from "../lib/verification.js";
import { READ_ONLY } from "./annotations.js";

export function registerVerificationTools(server: McpServer) {
  server.registerTool(
    "recommend_verification",
    {
      description:
        "Pick the right SDK auth path (off-chain tap, transfer, or token lookup). Omit useCase to get the decision tree and all use cases.",
      inputSchema: {
        useCase: z
          .enum(["login_ui_only", "set_owner", "lookup_after_tap"] as [
            VerificationUseCase,
            ...VerificationUseCase[],
          ])
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
}
