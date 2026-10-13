/** Compute-unit limit and price for the link transaction. */

/** set_owner is cheap; the secp256r1 precompile is charged per signature, not per CU. */
export const LINK_COMPUTE_UNIT_LIMIT = 60_000;
export const LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50_000n;
