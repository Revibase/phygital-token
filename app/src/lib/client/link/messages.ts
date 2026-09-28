import { ApiClientError } from '../api';
import { LinkTransactionRejected } from '$lib/shared/link-transaction';
import type { LinkErrorCode, TapFailureReason } from '$lib/shared/types';

/** What to offer after a failure. */
export type Recovery = 'tap_again' | 'retry' | 'add_sol' | 'start_over' | 'none';

export type FriendlyError = { title: string; body: string; recovery: Recovery; code: string; detail?: string };

const LINK_COPY: Record<LinkErrorCode, Omit<FriendlyError, 'code'>> = {
	accessory_locked: {
		title: 'This accessory is locked',
		body: 'It’s already linked and locked to a wallet. The linked wallet has to release it first.',
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
		body: 'For your security, each approval only lasts a few minutes. Tap your accessory again to continue.',
		recovery: 'tap_again'
	},
	insufficient_sol: {
		title: 'Your wallet needs a little SOL',
		body: 'Linking costs a tiny network fee (well under 0.001 SOL). Add some SOL to this wallet, then try again.',
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

function isUserRejection(err: unknown): boolean {
	const e = err as { name?: string; message?: string; code?: number };
	if (e?.code === 4001) return true;
	if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return true;
	return /reject|denied|declin|cancel/i.test(e?.message ?? '');
}

/** Normalize anything thrown during a ceremony into calm, specific copy. */
export function describeError(err: unknown, context: 'tap' | 'wallet' = 'wallet'): FriendlyError {
	if (err instanceof ApiClientError) {
		if (err.code in LINK_COPY) return { ...linkErrorCopy(err.code as LinkErrorCode), detail: err.message };
		if (err.code === 'expired') return { title: 'This session expired', body: err.message, recovery: 'start_over', code: err.code };
		if (err.code === 'forbidden' || err.code === 'not_found' || err.code === 'conflict') {
			return { title: 'This link isn’t active anymore', body: err.message, recovery: 'start_over', code: err.code };
		}
		return { title: 'Something went wrong', body: err.message, recovery: 'retry', code: String(err.code) };
	}
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
	if (/WebAuthn is not supported/i.test(message)) {
		return {
			title: 'This browser can’t read your accessory',
			body: 'Open this page in Safari (iPhone) or Chrome (Android) to tap.',
			recovery: 'none',
			code: 'no_webauthn'
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
		title: 'Couldn’t verify this accessory',
		body: 'The link didn’t come from a genuine accessory. If it was copied or shared, tap the accessory itself.'
	},
	replayed: {
		title: 'That tap was already used',
		body: 'Each tap works once. Hold your accessory to your phone again.'
	},
	unknown: {
		title: 'Not set up yet',
		body: 'This accessory is genuine but hasn’t been registered. Contact the issuer.'
	},
	network: {
		title: 'Connection problem',
		body: 'Your accessory is fine — we just couldn’t reach the network. Check your connection and tap again.'
	},
	expired: {
		title: 'Tap to continue',
		body: 'For your security, sessions end after a few minutes. Hold your accessory to your phone again.'
	}
};
