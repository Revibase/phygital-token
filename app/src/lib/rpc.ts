import { createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

export function getRpcUrl(): string {
	return env.PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC;
}

let rpc: Rpc<SolanaRpcApi> | null = null;

export function getRpc(): Rpc<SolanaRpcApi> {
	if (!browser) {
		throw new Error('RPC is only available in the browser');
	}
	if (!rpc) {
		rpc = createSolanaRpc(getRpcUrl());
	}
	return rpc;
}
