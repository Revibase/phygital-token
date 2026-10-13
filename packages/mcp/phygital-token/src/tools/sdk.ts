/** The SDK export map. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult } from "../lib/format.js";
import { SDK_SURFACE } from "../lib/sdk-surface.js";
import { READ_ONLY } from "./annotations.js";

export function registerSdkTools(server: McpServer) {
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
