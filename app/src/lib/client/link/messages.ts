import { PhygitalTokenError, type PhygitalTokenErrorCode } from 'phygital-token-sdk';
import { ApiClientError } from '../api';
import { LinkTransactionRejected } from '$lib/shared/link-transaction';
import { fromSendError } from '$lib/shared/link-errors';
import type { LinkErrorCode, TapFailureReason } from '$lib/shared/types';

export type Recovery = 'tap_again' | 'retry' | 'add_sol' | 'start_over' | 'none';

export type FriendlyError = { title: string; body: string; recovery: Recovery; code: string; detail?: string };

const LINK_COPY: Record<LinkErrorCode, Omit<FriendlyError, 'code'>> = {
	accessory_locked: {
		title: 'This accessory is locked',
		body: 'It’s already linked and locked to a wallet. The owner has to unlink it first.',
		recovery: 'none'
	},
	accessory_permanent: {
		title: 'Permanently linked',
		body: 'This accessory was made for one wallet, and that link can’t be changed.',
		recovery: 'none'
	},
	different_accessory: {
		title: 'That’s a different accessory',
		body: 'Use the same accessory you tapped at the start.',
		recovery: 'tap_again'
	},
	tap_rejected: {
		title: 'We couldn’t confirm that tap',
		body: 'Hold your accessory steady against your phone until it finishes, then try again.',
		recovery: 'tap_again'
	},
	too_slow: {
		title: 'That took a little too long',
		body: 'Each approval only lasts a few minutes. Tap your accessory again to continue.',
		recovery: 'tap_again'
	},
	insufficient_sol: {
		title: 'Your wallet needs a little SOL',
		body: 'The wallet you’re linking pays a tiny network fee (well under 0.001 SOL). Add some SOL to it, then try again.',
		recovery: 'add_sol'
	},
	already_used: {
		title: 'That approval was already used',
		body: 'Tap your accessory again to create a fresh one.',
		recovery: 'tap_again'
	},
	wallet_rejected: {
		title: 'Cancelled in your wallet',
		body: 'Nothing was changed. You can try again whenever you’re ready.',
		recovery: 'retry'
	},
	network: {
		title: 'Connection problem',
		body: 'We couldn’t reach the network. Check your connection and try again.',
		recovery: 'retry'
	},
	unknown: {
		title: 'Something went wrong',
		body: 'Nothing was changed. Please try again.',
		recovery: 'retry'
	}
};

export function linkErrorCopy(code: LinkErrorCode | null | undefined): FriendlyError {
	const c = code ?? 'unknown';
	return { ...(LINK_COPY[c] ?? LINK_COPY.unknown), code: c };
}

const TAP_REJECTED_CODES: PhygitalTokenErrorCode[] = [
	'INVALID_CREDENTIAL_ID',
	'PASSKEY_RECOVERY_FAILED',
	'PASSKEY_NOT_RECOGNIZED',
	'PASSKEY_AMBIGUOUS',
	'INVALID_ASSERTION'
];

function isUserRejection(err: unknown): boolean {
	if (err instanceof PhygitalTokenError && err.code === 'AUTHENTICATION_CANCELLED') return true;
	const e = err as { name?: string; message?: string; code?: number };
	if (e?.code === 4001) return true;
	if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return true;
	return /reject|denied|declin|cancel/i.test(e?.message ?? '');
}

export function describeError(err: unknown, context: 'tap' | 'wallet' = 'wallet'): FriendlyError {
	if (err instanceof ApiClientError) {
		if (err.code in LINK_COPY) return { ...linkErrorCopy(err.code as LinkErrorCode), detail: err.message };
		if (err.code === 'unknown_accessory') {
			return { title: 'We don’t recognize this accessory', body: 'It isn’t registered, so we can’t confirm it’s genuine.', recovery: 'none', code: err.code };
		}
		if (err.code === 'not_owner') {
			return { title: 'That’s a different wallet', body: 'This accessory isn’t linked to the wallet you connected.', recovery: 'none', code: err.code };
		}
		if (err.code === 'bad_signature') {
			return { title: 'We couldn’t verify that signature', body: 'Approve the message in your wallet, then try again.', recovery: 'retry', code: err.code };
		}
		if (err.code === 'expired') return { title: 'This session expired', body: err.message, recovery: 'start_over', code: err.code };
		if (err.code === 'forbidden' || err.code === 'not_found' || err.code === 'conflict') {
			return { title: 'This link isn’t active anymore', body: err.message, recovery: 'start_over', code: err.code };
		}
		return { title: 'Something went wrong', body: err.message, recovery: 'retry', code: String(err.code) };
	}
	const onChain = fromSendError(err);
	if (onChain && onChain !== 'unknown') return { ...linkErrorCopy(onChain), detail: err instanceof Error ? err.message : undefined };
	if (err instanceof LinkTransactionRejected) {
		return {
			title: 'We stopped an unexpected transaction',
			body: 'What your wallet was asked to sign didn’t match this link, so nothing was sent.',
			recovery: 'start_over',
			code: 'validation',
			detail: err.message
		};
	}
	if (isUserRejection(err)) {
		if (context === 'tap') {
			return {
				title: 'The tap didn’t finish',
				body: 'Hold your accessory to your phone when prompted and keep it there until it’s done.',
				recovery: 'tap_again',
				code: 'tap_cancelled'
			};
		}
		return linkErrorCopy('wallet_rejected');
	}
	const message = err instanceof Error ? err.message : String(err);
	if (err instanceof PhygitalTokenError && err.code === 'WEBAUTHN_UNSUPPORTED') {
		return {
			title: 'This browser can’t read your accessory',
			body: 'Open this page in Safari (iPhone) or Chrome (Android) to tap.',
			recovery: 'none',
			code: 'no_webauthn'
		};
	}
	if (err instanceof PhygitalTokenError && TAP_REJECTED_CODES.includes(err.code)) {
		return {
			title: 'We couldn’t confirm that tap',
			body: 'Hold your accessory steady against your phone until it finishes, then try again.',
			recovery: 'tap_again',
			code: 'tap_rejected',
			detail: message
		};
	}
	return { ...linkErrorCopy('unknown'), detail: message };
}

export const TAP_FAILURE_COPY: Record<TapFailureReason, { title: string; body: string }> = {
	malformed: {
		title: 'Couldn’t read that tap',
		body: 'Hold your accessory to your phone again and keep it there for a moment.'
	},
	invalid: {
		title: 'Couldn’t verify this tap',
		body: 'The link wasn’t signed by an accessory. If it was copied or edited, tap the accessory itself.'
	},
	replayed: {
		title: 'That tap was already used',
		body: 'Each tap works once. Hold your accessory to your phone again.'
	},
	unknown: {
		title: 'We don’t recognize this accessory',
		body: 'It isn’t registered, so we can’t confirm it’s genuine. If you were expecting it to work, contact whoever issued it.'
	},
	network: {
		title: 'Connection problem',
		body: 'We couldn’t reach the network to check this accessory. Check your connection and tap again.'
	},
	expired: {
		title: 'Tap to continue',
		body: 'This page closes after a few minutes. Tap Continue, then hold your accessory to your phone.'
	}
};
