import { address } from "@solana/kit";

export const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const SECP256R1_PROGRAM_ADDRESS = address(
  "Secp256r1SigVerify1111111111111111111111111",
);

export const TRANSFER_HOOK_PROGRAM_ADDRESS = address(
  "FCBG7gTThZ9hg4axra4UqWBerBhdjhdBLqxD1jicg84G",
);

/**
 * Default server endpoint that resolves a tapped card's metadata and enforces the
 * counter check. Override per-call by passing a custom fetcher to `verifyWithServerCheck`.
 */
export const DEFAULT_CARD_METADATA_ENDPOINT =
  "https://revibase.com/api/verify";

