import { address } from "@solana/kit";

export const SECP256R1_PROGRAM_ADDRESS = address(
  "Secp256r1SigVerify1111111111111111111111111",
);

/**
 * Squads multisig whose vault-0 is {@link ADMIN}.
 * Threshold 1; rent collector is the vault.
 */
export const INITIALIZE_MULTISIG_PDA = address(
  "EU7WsC97HeC4fLjax7otY7g4rPMy3Us1WJKNCdr2Kn7U",
);

/** Sole wallet allowed to call `initialize` and `set_mint` (Squads vault-0 on mainnet). */
export const ADMIN = address(
  "G6kBnedts6uAivtY72ToaFHBs1UVbT9udiXmQZgMEjoF",
);

export const SLOT_HASHES_SYSVAR_ADDRESS = address(
  "SysvarS1otHashes111111111111111111111111111",
);

export const TRANSFER_ACTION_BYTES = new TextEncoder().encode("transfer");
