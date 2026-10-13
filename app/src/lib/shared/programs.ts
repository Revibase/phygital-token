import { address } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

/** The native programs the app knows by address. */
export { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS };
export const TOKEN_2022_PROGRAM_ADDRESS = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const TOKEN_PROGRAMS: ReadonlySet<string> = new Set([
	TOKEN_PROGRAM_ADDRESS,
	TOKEN_2022_PROGRAM_ADDRESS
]);
/** Programs tap payments use: SOL and token transfers, and creating the recipient's token account. */
export const PAYMENT_PROGRAMS: ReadonlySet<string> = new Set([
	SYSTEM_PROGRAM_ADDRESS,
	...TOKEN_PROGRAMS,
	ASSOCIATED_TOKEN_PROGRAM_ADDRESS
]);
