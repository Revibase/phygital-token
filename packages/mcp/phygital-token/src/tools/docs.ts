/** Documentation search and retrieval. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listDocs, readDocById, searchDocs } from "../lib/docs.js";
import { jsonResult, textResult } from "../lib/format.js";
import { READ_ONLY } from "./annotations.js";

export function registerDocTools(server: McpServer) {
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
}
