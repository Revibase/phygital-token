import { address } from "@solana/kit";

export const RP_ID = "revibase.com";

export const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
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

export const SLOT_HASHES_SYSVAR_ADDRESS = address(
  "SysvarS1otHashes111111111111111111111111111",
);

export const TRANSFER_ACTION_BYTES = new TextEncoder().encode("transfer");

export const METADATA_KEY_GROUP_UNIQUE_ID = "ui";
export const METADATA_KEY_SECP256R1 = "s";

export const TOKEN_GROUP_MEMBER_EXTENSION_TYPE = 108;
export const TOKEN_METADATA_EXTENSION_TYPE = 19;

export const COMPRESSED_PUBKEY_SIZE = 33;
export const SIGNATURE_SIZE = 64;
export const SIGNATURE_OFFSETS_SIZE = 14;
export const SIGNATURE_OFFSETS_START = 2;
