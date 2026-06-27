import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GRAPHIFY_GRAPH_PATH, pathExists, resolveRepoRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export type GraphifyMode = "query" | "explain" | "path";

export async function runGraphify(
  mode: GraphifyMode,
  args: string[],
): Promise<string> {
  const repoRoot = resolveRepoRoot();
  const graphExists = await pathExists(GRAPHIFY_GRAPH_PATH);

  if (!graphExists) {
    throw new Error(
      `Graphify graph not found at ${GRAPHIFY_GRAPH_PATH}. Run "graphify update ." from the repo root first.`,
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
