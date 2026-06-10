import type { Address } from '@solana/kit';

const CLUSTER = 'devnet';

export function mintExplorerUrl(mint: Address): string {
	return `https://solscan.io/token/${mint}?cluster=${CLUSTER}`;
}

export function txExplorerUrl(signature: string): string {
	return `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`;
}
