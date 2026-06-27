import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathExists, resolveGraphifyGraphPath, resolveRepoRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export type GraphifyMode = "query" | "explain" | "path";

export async function runGraphify(
  mode: GraphifyMode,
  args: string[],
): Promise<string> {
  const repoRoot = resolveRepoRoot();
  const graphPath = resolveGraphifyGraphPath();
  const graphExists = await pathExists(graphPath);

  if (!graphExists) {
    throw new Error(
      `Graphify graph not found at ${graphPath}. Clone the phygital-token repo, run "graphify update .", and set PHYGITAL_TOKEN_REPO_ROOT to the repo root — or use search_docs / read_doc instead.`,
    );
  }

  const commandArgs = [mode, ...args];

  try {
    const { stdout, stderr } = await execFileAsync("graphify", commandArgs, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });

    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    return output || "(no output)";
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      const output = [execError.stdout?.trim(), execError.stderr?.trim()]
        .filter(Boolean)
        .join("\n");
      if (output) {
        return output;
      }
    }

    throw error;
  }
}
