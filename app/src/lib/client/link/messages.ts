import { PhygitalTokenError } from 'phygital-token-sdk';
import { ApiClientError } from '../api';
import { LinkTransactionRejected } from '#lib/shared/link-transaction.ts';
import { TransferRejected } from '#lib/shared/wallet-transfer.ts';
import { fromSendError } from '#lib/shared/link-errors.ts';
import type { LinkErrorCode, TapFailureReason } from '#lib/shared/types.ts';

export type FriendlyError = {
	title: string;
	body: string;
	detail?: string;
};

const LINK_COPY: Record<LinkErrorCode, FriendlyError> = {
	accessory_locked: {
		title: 'This accessory is locked',
		body: 'Its owner has to release it first.'
	},
	accessory_permanent: {
		title: 'This accessory can’t change owner',
		body: 'It was made for one wallet.'
	},
	different_accessory: {
		title: 'That’s a different accessory',
		body: 'Use the one you tapped first.'
	},
	tap_rejected: {
		title: 'Couldn’t confirm that tap',
		body: 'Hold your accessory still until it’s done, then try again.'
	},
	too_slow: {
		title: 'Approval expired',
		body: 'Approvals last about a minute. Tap your accessory again.'
	},
	insufficient_sol: {
		title: 'Not enough SOL',
		body: 'Add a little SOL to this wallet for the network fee, then try again.'
	},
	already_used: {
		title: 'Approval already used',
		body: 'Tap your accessory again.'
	},
	wallet_rejected: {
		title: 'Cancelled',
		body: 'Nothing was changed.'
	},
	network: {
		title: 'Can’t connect',
		body: 'Check your connection and try again.'
	},
	unknown: {
		title: 'Something went wrong',
		body: 'Nothing was changed. Try again.'
	}
};

const UNKNOWN_ACCESSORY: FriendlyError = {
	title: 'Unknown accessory',
	body: 'It isn’t set up yet. Hold it to your phone again to set it up.'
};

export const ENROLL_COPY = {
	title: 'Set up your accessory',
	body: 'It’s new, so it needs a one-time setup before you can claim it.',
	action: 'Set up',
	saving: 'This takes a few seconds.',
	retry: 'Try again',
	unsupported: 'Open this page in Safari or Chrome to set up this accessory.'
};

export function linkErrorCopy(code: LinkErrorCode | null | undefined): FriendlyError {
	return LINK_COPY[code ?? 'unknown'] ?? LINK_COPY.unknown;
}

function errorCauses(err: unknown): unknown[] {
	const items: unknown[] = [];
	const seen = new Set<unknown>();
	let current: unknown = err;
	while (current != null && (typeof current === 'object' || typeof current === 'string')) {
		if (typeof current === 'object') {
			if (seen.has(current)) break;
			seen.add(current);
		}
		items.push(current);
		if (typeof current !== 'object') break;
		current = (current as { cause?: unknown }).cause;
	}
	return items;
}

function errorMessage(err: unknown): string {
	if (typeof err === 'string') return err;
	if (err instanceof Error) return err.message;
	if (
		err &&
		typeof err === 'object' &&
		typeof (err as { message?: unknown }).message === 'string'
	) {
		return (err as { message: string }).message;
	}
	return '';
}

/** Closing Privy’s approval. The outer message is often “Failed to connect to wallet”. */
function closedApproval(err: unknown): boolean {
	if (err && typeof err === 'object' && (err as { code?: unknown }).code === 4001) return true;
	const message = errorMessage(err);
	return /user exited/i.test(message) || /user rejected the request/i.test(message);
}

/** The person closed an approval. Nothing was signed or sent. */
export function isDismissedFlow(err: unknown): boolean {
	return errorCauses(err).some(closedApproval);
}

/** Null when they closed the approval, so callers do not show an error. */
export function actionFailure(err: unknown): FriendlyError | null {
	if (isDismissedFlow(err)) return null;
	return describeError(err);
}

function isUserRejection(err: unknown): boolean {
	if (err instanceof PhygitalTokenError && err.code === 'AUTHENTICATION_CANCELLED') return true;
	const e = err as { name?: string; code?: number };
	if (e?.code === 4001) return true;
	if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return true;
	if (/reject|denied|declin|cancel/i.test(errorMessage(err))) return true;
	return errorCauses(err).slice(1).some(closedApproval);
}

export function describeError(err: unknown, context: 'tap' | 'wallet' = 'wallet'): FriendlyError {
	if (err instanceof ApiClientError) {
		if (err.code in LINK_COPY)
			return { ...linkErrorCopy(err.code as LinkErrorCode), detail: err.message };
		if (err.code === 'unknown_accessory') return UNKNOWN_ACCESSORY;
		if (err.code === 'not_owner') {
			return {
				title: 'Not the owner’s wallet',
				body: 'This wallet doesn’t own this accessory.'
			};
		}
		if (err.code === 'bad_signature') {
			return {
				title: 'Couldn’t verify the signature',
				body: 'Approve the message in your wallet, then try again.'
			};
		}
		if (err.code === 'expired') return { title: 'Session expired', body: err.message };
		if (err.code === 'invalid_attestation') {
			return {
				title: 'Couldn’t verify this accessory',
				body: 'It didn’t prove it’s a genuine Revibase accessory, so it can’t be set up.',
				detail: err.message
			};
		}
		if (err.code === 'not_packed') {
			return {
				title: 'Can’t set up this accessory',
				body: 'It isn’t registered with Revibase yet. Contact whoever issued it.'
			};
		}
		if (err.code === 'already_enrolled') {
			return {
				title: 'Already set up',
				body: 'This accessory belongs to another record. Contact whoever issued it.'
			};
		}
		if (err.code === 'in_progress') {
			return { title: 'Setting up already', body: 'Wait a moment, then try again.' };
		}
		if (err.code === 'enroll_unavailable') {
			return {
				title: 'Couldn’t finish setting up',
				body: 'Your accessory is fine. Try again later.',
				detail: err.message
			};
		}
		if (err.code === 'enroll_failed') {
			return {
				title: 'Couldn’t finish setting up',
				body: 'Your accessory is fine. Tap Try again, then hold it to your phone.',
				detail: err.message
			};
		}
		if (err.code === 'fee_payer_refused') {
			return {
				title: 'Couldn’t send this transaction',
				body: 'Nothing was changed.',
				detail: err.message
			};
		}
		if (err.code === 'transaction_changed') {
			return {
				title: 'The transaction changed',
				body: 'Nothing was sent. Try again.',
				detail: err.message
			};
		}
		if (err.code === 'fee_payer_unavailable') {
			return {
				title: 'Sending is unavailable',
				body: 'Nothing was sent. Try again later.'
			};
		}
		if (err.code === 'submit_unknown') {
			return {
				title: 'Couldn’t confirm the transaction',
				body: 'Check your balance before trying again, so nothing is sent twice.'
			};
		}
		if (err.code === 'forbidden' || err.code === 'not_found' || err.code === 'conflict') {
			return { title: 'No longer available', body: err.message };
		}
		return {
			title: 'Something went wrong',
			body: err.message
		};
	}
	const onChain = fromSendError(err);
	if (onChain && onChain !== 'unknown')
		return { ...linkErrorCopy(onChain), detail: err instanceof Error ? err.message : undefined };
	if (err instanceof LinkTransactionRejected) {
		return {
			title: 'Unexpected transaction blocked',
			body: 'It didn’t match what you asked for, so nothing was sent.',
			detail: err.message
		};
	}
	if (err instanceof TransferRejected) {
		return {
			title: 'Transfer blocked',
			body: 'It didn’t match what you asked to send, so nothing was sent.',
			detail: err.message
		};
	}
	if (isUserRejection(err)) {
		if (context === 'tap') {
			return {
				title: 'The tap didn’t finish',
				body: 'Hold your accessory to your phone until it’s done.'
			};
		}
		return linkErrorCopy('wallet_rejected');
	}
	const message = err instanceof Error ? err.message : String(err);
	if (err instanceof PhygitalTokenError && err.code === 'WEBAUTHN_UNSUPPORTED') {
		return {
			title: 'This browser can’t read accessories',
			body: 'Open this page in Safari or Chrome.'
		};
	}
	if (err instanceof PhygitalTokenError && err.code === 'INVALID_ASSERTION') {
		return { ...linkErrorCopy('tap_rejected'), detail: message };
	}
	return { ...linkErrorCopy('unknown'), detail: message };
}

export const TAP_FAILURE_COPY: Record<TapFailureReason, { title: string; body: string }> = {
	malformed: {
		title: 'Couldn’t read that tap',
		body: 'Hold your accessory to your phone again, and keep it there for a moment.'
	},
	invalid: {
		title: 'Couldn’t verify that tap',
		body: 'This link didn’t come from an accessory. Tap the accessory itself.'
	},
	replayed: {
		title: 'That tap was already used',
		body: 'Each tap works once. Tap your accessory again.'
	},
	unknown: UNKNOWN_ACCESSORY,
	network: {
		title: 'Can’t connect',
		body: 'Check your connection, then tap your accessory again.'
	},
	expired: {
		title: 'Session expired',
		body: 'Tap Continue, then hold your accessory to your phone.'
	}
};
