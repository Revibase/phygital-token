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

export const SLOT_HASHES_SYSVAR_ADDRESS = address(
  "SysvarS1otHashes111111111111111111111111111",
);

export const TRANSFER_ACTION_BYTES = new TextEncoder().encode("transfer");

export const VERIFY_ASSET_ACTION_BYTES = new TextEncoder().encode("verify_asset");

export const TRANSFER_HOOK_PROGRAM_ADDRESS = address(
  "2jgBvsDmUW9gEsakLDEvnEFEjG1WwCUzGtNbqbtUr7xR",
);

export const DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT = `https://app.revibase.com/api/verifyAsset`;