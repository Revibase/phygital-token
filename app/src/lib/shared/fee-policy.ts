/**
 * Compute-unit limits and prices for app transactions. The fee service
 * (`server/sponsor`) checks sponsored transactions against the same numbers,
 * so this module must stay free of client-only code.
 */

/** set_owner is cheap; the secp256r1 precompile is charged per signature, not per CU. */
export const LINK_COMPUTE_UNIT_LIMIT = 60_000;
export const LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50_000n;

/** A compute-unit price over `units`, in lamports, rounded up (as the fee service checks it). */
export function priorityFeeLamports(microLamportsPerUnit: bigint, units: number): bigint {
	return (microLamportsPerUnit * BigInt(units) + 999_999n) / 1_000_000n;
}

/** The v1 message config every app transaction uses, at the app's compute-unit price. */
export function v1MessageConfig(units: number) {
	return {
		computeUnitLimit: units,
		loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
		priorityFeeLamports: priorityFeeLamports(LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS, units)
	};
}
