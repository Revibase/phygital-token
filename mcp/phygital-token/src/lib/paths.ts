import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Monorepo root (phygital-token/). */
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

export const SDK_DOCS_DIR = path.join(
  REPO_ROOT,
  "clients/js/phygital-token/docs",
);

export const GLOSSARY_PATH = path.join(REPO_ROOT, "GLOSSARY.md");

export const SDK_README_PATH = path.join(
  REPO_ROOT,
  "clients/js/phygital-token/README.md",
);

export const MCP_DOCS_DIR = path.join(PACKAGE_ROOT, "docs");

export const VERIFY_TS_PATH = path.join(
  REPO_ROOT,
  "clients/js/phygital-token/src/utils/verify.ts",
);

export const VERIFY_ASSET_TS_PATH = path.join(
  REPO_ROOT,
  "clients/js/phygital-token/src/instructions/verifyAsset.ts",
);

export const RUST_CLIENT_VERIFY_ASSET_PATH = path.join(
  REPO_ROOT,
  "clients/rust/phygital-token/src/generated/instructions/verify_asset.rs",
);

export const GRAPHIFY_GRAPH_PATH = path.join(REPO_ROOT, "graphify-out/graph.json");

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveRepoRoot(): string {
  return process.env.PHYGITAL_TOKEN_REPO_ROOT?.trim() || REPO_ROOT;
}
