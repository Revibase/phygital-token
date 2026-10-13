import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocTools } from "./docs.js";
import { registerPlanTools } from "./plan.js";
import { registerSdkTools } from "./sdk.js";
import { registerVerificationTools } from "./verification.js";

/** Registers every tool. All are offline and read-only. */
export function registerTools(server: McpServer) {
  registerDocTools(server);
  registerVerificationTools(server);
  registerPlanTools(server);
  registerSdkTools(server);
}
