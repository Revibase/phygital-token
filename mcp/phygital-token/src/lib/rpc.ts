import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

let cachedRpc: Rpc<SolanaRpcApi> | null = null;
let cachedRpcUrl: string | null = null;

export function getRpcUrl(override?: string): string {
  const url =
    override?.trim() ||
    process.env.PHYGITAL_TOKEN_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim();

  if (!url) {
    throw new Error(
      "RPC URL required. Pass rpcUrl to the tool or set PHYGITAL_TOKEN_RPC_URL (or HELIUS_RPC_URL).",
    );
  }

  return url;
}

export function createRpc(override?: string): Rpc<SolanaRpcApi> {
  const url = getRpcUrl(override);

  if (cachedRpc && cachedRpcUrl === url) {
    return cachedRpc;
  }

  cachedRpc = createSolanaRpc(url);
  cachedRpcUrl = url;
  return cachedRpc;
}
