import type { V1TransactionConfig } from '@solana/kit';

/**
 * The budget of a link or release transaction. Both are v1 transactions (up to
 * 4096 bytes), so the budget lives in the message header, not in compute-budget
 * instructions, and a limit left unset budgets zero.
 *
 * set_owner is cheap (the secp256r1 precompile is charged per signature, not per
 * CU); through Revibase Passkey's execute a claim uses about 17k CU. The
 * loaded-data limit covers both programs with room to grow. The priority fee is
 * what 50,000 micro-lamports per CU over the limit used to cost.
 */
export const LINK_TX_CONFIG = {
	computeUnitLimit: 60_000,
	loadedAccountsDataSizeLimit: 1024 * 1024,
	priorityFeeLamports: 3_000n
} as const satisfies V1TransactionConfig;
