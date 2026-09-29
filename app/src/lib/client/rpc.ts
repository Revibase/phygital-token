import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';

let url: string | null = null;
let rpc: Rpc<SolanaRpcApi> | null = null;

export function configureRpc(rpcUrl: string) {
	if (url === rpcUrl) return;
	url = rpcUrl;
	rpc = null;
}

export function rpcUrl(): string {
	if (!url) throw new Error('RPC is not configured yet');
	return url;
}

export function browserRpc(): Rpc<SolanaRpcApi> {
	rpc ??= createSolanaRpc(rpcUrl());
	return rpc;
}
