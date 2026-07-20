import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const require = createRequire(import.meta.url);

export const MCP_DOCS_DIR = path.join(PACKAGE_ROOT, "docs");

export const GLOSSARY_PATH = path.join(MCP_DOCS_DIR, "glossary.md");

/** Monorepo root when developing in-tree; override with PHYGITAL_TOKEN_REPO_ROOT. */
export function resolveRepoRoot(): string {
  const override = process.env.PHYGITAL_TOKEN_REPO_ROOT?.trim();
  if (override) {
    return override;
  }
  return path.resolve(PACKAGE_ROOT, "../..");
}

function resolveSdkPackageRoot(): string | undefined {
  try {
    return path.dirname(require.resolve("phygital-token-sdk/package.json"));
  } catch {
    return undefined;
  }
}

/** SDK docs from the installed npm package, or monorepo fallback. */
export async function resolveSdkDocsDir(): Promise<string | undefined> {
  const sdkRoot = resolveSdkPackageRoot();
  if (sdkRoot) {
    const docsDir = path.join(sdkRoot, "docs");
    if (await pathExists(docsDir)) {
      return docsDir;
    }
  }

  const monorepoDocs = path.join(
    resolveRepoRoot(),
    "clients/js/phygital-token/docs",
  );
  if (await pathExists(monorepoDocs)) {
    return monorepoDocs;
  }

  return undefined;
}

export async function resolveSdkReadmePath(): Promise<string | undefined> {
  const sdkRoot = resolveSdkPackageRoot();
  if (sdkRoot) {
    const readmePath = path.join(sdkRoot, "README.md");
    if (await pathExists(readmePath)) {
      return readmePath;
    }
  }

  const monorepoReadme = path.join(
    resolveRepoRoot(),
    "clients/js/phygital-token/README.md",
  );
  if (await pathExists(monorepoReadme)) {
    return monorepoReadme;
  }

  return undefined;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
