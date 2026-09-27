import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

let rpc: Rpc<SolanaRpcApi> | null = null;

/** Browser RPC via the app's allow-listed proxy (keeps the provider key server-side). */
export function browserRpc(): Rpc<SolanaRpcApi> {
	rpc ??= createSolanaRpc(new URL('/api/rpc', window.location.origin).href);
	return rpc;
}
