import { address } from "@solana/kit";

export const SECP256R1_PROGRAM_ADDRESS = address("Secp256r1SigVerify1111111111111111111111111");

/** The card signs only `authorize || payload`, so its signatures can't be mistaken for WebAuthn ones. */
export const AUTHORIZE_PREFIX = new TextEncoder().encode("authorize");

/** Longest message the card signs, prefix included (Chrome drops longer allowList ids). */
export const MAX_ALLOW_LIST_ID = 640;

/** Max payload after {@link AUTHORIZE_PREFIX}. */
export const MAX_AUTHORIZE_PAYLOAD = MAX_ALLOW_LIST_ID - AUTHORIZE_PREFIX.length;
