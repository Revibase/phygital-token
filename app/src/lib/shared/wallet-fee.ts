import type { V1TransactionConfig } from '@solana/kit';

/** Network fee for a transfer. The connected wallet pays its own signature. */
const LAMPORTS_PER_SIGNATURE = 5_000n;

/**
 * A transfer as a v1 transaction. Opening the recipient's token account is the
 * costliest call; the loaded-data limit covers the token programs (Token-2022 is large).
 */
export const TRANSFER_TX_CONFIG = {
	computeUnitLimit: 200_000,
	loadedAccountsDataSizeLimit: 4 * 1024 * 1024,
	priorityFeeLamports: 3_000n
} as const satisfies V1TransactionConfig;

/** Every signature costs the same. */
export function networkFeeLamports(signatures: number, config: V1TransactionConfig): bigint {
	return BigInt(signatures) * LAMPORTS_PER_SIGNATURE + (config.priorityFeeLamports ?? 0n);
}

/** The fee a decoded transaction will be charged for its signers. */
export function messageFeeLamports(message: {
	signers: readonly unknown[];
	config: V1TransactionConfig;
}): bigint {
	return networkFeeLamports(message.signers.length, message.config);
}
