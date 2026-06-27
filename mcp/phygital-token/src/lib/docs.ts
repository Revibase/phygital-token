import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  GLOSSARY_PATH,
  MCP_DOCS_DIR,
  pathExists,
  resolveSdkDocsDir,
  resolveSdkReadmePath,
} from "./paths.js";

export type DocCategory =
  | "gating"
  | "verification"
  | "building-on-phygital"
  | "sdk"
  | "glossary"
  | "readme";

export type DocEntry = {
  id: string;
  title: string;
  path: string;
  category: DocCategory;
};

async function collectMarkdownFiles(
  dir: string,
  category: DocCategory,
  prefix = "",
): Promise<DocEntry[]> {
  const entries: DocEntry[] = [];
  const items = await readdir(dir, { withFileTypes: true });

  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      entries.push(...(await collectMarkdownFiles(fullPath, category, relative)));
      continue;
    }

    if (!item.name.endsWith(".md")) {
      continue;
    }

    const title = item.name.replace(/\.md$/, "");
    entries.push({
      id: `${category}:${relative.replace(/\.md$/, "")}`,
      title,
      path: fullPath,
      category,
    });
  }

  return entries;
}

export async function listDocs(): Promise<DocEntry[]> {
  const docs: DocEntry[] = [];

  const sdkDocsDir = await resolveSdkDocsDir();
  if (sdkDocsDir) {
    const gatingDir = path.join(sdkDocsDir, "gating");
    if (await pathExists(gatingDir)) {
      docs.push(...(await collectMarkdownFiles(gatingDir, "gating")));
    }
  }

  if (await pathExists(MCP_DOCS_DIR)) {
    const verificationDir = path.join(MCP_DOCS_DIR, "verification");
    const buildingDir = path.join(MCP_DOCS_DIR, "building-on-phygital");
    const sdkDir = path.join(MCP_DOCS_DIR, "sdk");

    if (await pathExists(verificationDir)) {
      docs.push(...(await collectMarkdownFiles(verificationDir, "verification")));
    }
    if (await pathExists(buildingDir)) {
      docs.push(...(await collectMarkdownFiles(buildingDir, "building-on-phygital")));
    }
    if (await pathExists(sdkDir)) {
      docs.push(...(await collectMarkdownFiles(sdkDir, "sdk")));
    }
  }

  if (await pathExists(GLOSSARY_PATH)) {
    docs.push({
      id: "glossary",
      title: "Glossary",
      path: GLOSSARY_PATH,
      category: "glossary",
    });
  }

  const sdkReadmePath = await resolveSdkReadmePath();
  if (sdkReadmePath) {
    docs.push({
      id: "readme",
      title: "SDK README",
      path: sdkReadmePath,
      category: "readme",
    });
  }

  return docs;
}

export async function readDocById(docId: string): Promise<string> {
  const docs = await listDocs();
  const match = docs.find((doc) => doc.id === docId);

  if (!match) {
    throw new Error(`Unknown doc id "${docId}". Use list_docs or search_docs to discover ids.`);
  }

  return readFile(match.path, "utf8");
}

export type SearchDocsResult = {
  id: string;
  title: string;
  category: string;
  snippet: string;
  score: number;
};

function scoreLine(line: string, query: string): number {
  const lowerLine = line.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let score = 0;

  if (lowerLine.includes(lowerQuery)) {
    score += 10;
  }

  for (const term of lowerQuery.split(/\s+/).filter(Boolean)) {
    if (lowerLine.includes(term)) {
      score += 3;
    }
  }

  return score;
}

export async function searchDocs(
  query: string,
  limit = 8,
): Promise<SearchDocsResult[]> {
  const docs = await listDocs();
  const results: SearchDocsResult[] = [];

  for (const doc of docs) {
    const content = await readFile(doc.path, "utf8");
    const lines = content.split("\n");
    let bestScore = 0;
    let bestSnippet = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const score = scoreLine(line, query);

      if (score > bestScore) {
        bestScore = score;
        const start = Math.max(0, index - 1);
        const end = Math.min(lines.length, index + 2);
        bestSnippet = lines.slice(start, end).join("\n").trim();
      }
    }

    if (bestScore > 0) {
      results.push({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        snippet: bestSnippet,
        score: bestScore,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
