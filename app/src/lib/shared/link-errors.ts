import { isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM } from '@solana/kit';
import {
	PHYGITAL_TOKEN_ERROR__CHALLENGE_HASH_MISMATCH,
	PHYGITAL_TOKEN_ERROR__CLIENT_DATA_HASH_MISMATCH,
	PHYGITAL_TOKEN_ERROR__INVALID_SLOT_HASH,
	PHYGITAL_TOKEN_ERROR__PERMANENT_OWNER_IMMUTABLE,
	PHYGITAL_TOKEN_ERROR__SECP256R1_PUBKEY_MISMATCH,
	PHYGITAL_TOKEN_ERROR__STALE_SIGN_COUNT,
	PHYGITAL_TOKEN_ERROR__TOKEN_IS_CURRENTLY_LOCKED,
	PHYGITAL_TOKEN_ERROR__USER_PRESENCE_NOT_VERIFIED
} from 'phygital-token-sdk';

import type { LinkErrorCode } from '$lib/shared/types';

export function fromProgramError(code: number): LinkErrorCode {
	switch (code) {
		case PHYGITAL_TOKEN_ERROR__TOKEN_IS_CURRENTLY_LOCKED:
			return 'accessory_locked';
		case PHYGITAL_TOKEN_ERROR__PERMANENT_OWNER_IMMUTABLE:
			return 'accessory_permanent';
		case PHYGITAL_TOKEN_ERROR__INVALID_SLOT_HASH:
			return 'too_slow';
		case PHYGITAL_TOKEN_ERROR__STALE_SIGN_COUNT:
			return 'already_used';
		case PHYGITAL_TOKEN_ERROR__SECP256R1_PUBKEY_MISMATCH:
			return 'different_accessory';
		case PHYGITAL_TOKEN_ERROR__CHALLENGE_HASH_MISMATCH:
		case PHYGITAL_TOKEN_ERROR__CLIENT_DATA_HASH_MISMATCH:
		case PHYGITAL_TOKEN_ERROR__USER_PRESENCE_NOT_VERIFIED:
			return 'tap_rejected';
		default:
			return 'unknown';
	}
}

/**
 * Classify a `TransactionError` from simulate / getSignatureStatuses.
 * Shapes: `"InsufficientFundsForFee"`, `"AccountNotFound"`,
 * `{ InstructionError: [index, { Custom: n }] }`.
 */
export function fromTransactionError(err: unknown): LinkErrorCode {
	if (err === 'InsufficientFundsForFee' || err === 'AccountNotFound' || err === 'InsufficientFundsForRent') {
		return 'insufficient_sol';
	}
	if (err && typeof err === 'object' && 'InstructionError' in err) {
		const [, inner] = (err as { InstructionError: [number, unknown] }).InstructionError;
		if (inner && typeof inner === 'object' && 'Custom' in inner) {
			return fromProgramError(Number((inner as { Custom: number | bigint }).Custom));
		}
		// The secp256r1 precompile fails with a plain instruction error.
		return 'tap_rejected';
	}
	if (err === 'BlockhashNotFound') return 'too_slow';
	return 'unknown';
}

/**
 * Classify what `sendTransaction`'s preflight threw: the program's custom error
 * sits somewhere down the `cause` chain. `null` when it isn't a program error.
 */
export function fromSendError(err: unknown): LinkErrorCode | null {
	for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
		if (isSolanaError(e, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return fromProgramError(e.context.code);
	}
	return null;
}
