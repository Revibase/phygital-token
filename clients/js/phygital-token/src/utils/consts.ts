import { address } from "@solana/kit";

export const SECP256R1_PROGRAM_ADDRESS = address(
  "Secp256r1SigVerify1111111111111111111111111",
);

export const SLOT_HASHES_SYSVAR_ADDRESS = address(
  "SysvarS1otHashes111111111111111111111111111",
);

export const TRANSFER_ACTION_BYTES = new TextEncoder().encode("transfer");

export const VERIFY_ASSET_ACTION_BYTES = new TextEncoder().encode("verify_asset");
