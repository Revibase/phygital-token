/** Program and sysvar addresses the app's transaction builders and the fee service share. */
import { address } from '@solana/kit';

export const SECP256R1_PROGRAM_ADDRESS = address('Secp256r1SigVerify1111111111111111111111111');
export const SLOT_HASHES_SYSVAR = address('SysvarS1otHashes111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
/** Wallet guard program (Phantom and others wrap what they sign with its assertions). */
export const LIGHTHOUSE_PROGRAM_ADDRESS = address('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
