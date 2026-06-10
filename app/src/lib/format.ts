import type { Address } from '@solana/kit';

export function shortenAddress(value: Address | string, chars = 4): string {
	const text = String(value);
	if (text.length <= chars * 2 + 3) {
		return text;
	}
	return `${text.slice(0, chars)}…${text.slice(-chars)}`;
}

export function formatLamports(lamports: bigint): string {
	const sol = Number(lamports) / 1_000_000_000;
	return `${sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

export function formatTokenAmount(
	amount: bigint,
	symbol: string | null,
	decimals = 0
): string {
	if (decimals === 0) {
		return symbol ? `${amount.toString()} ${symbol}` : `${amount.toString()} tokens`;
	}
	const divisor = 10 ** decimals;
	const value = Number(amount) / divisor;
	const formatted = value.toLocaleString(undefined, { maximumFractionDigits: decimals });
	return symbol ? `${formatted} ${symbol}` : formatted;
}

/** Formats a UTC expiry timestamp (milliseconds since Unix epoch). */
export function formatCardExpiry(expiryMs: number): string | null {
	if (!Number.isFinite(expiryMs) || expiryMs <= 0) {
		return null;
	}

	const date = new Date(expiryMs);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.toLocaleDateString(undefined, {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

export function mapTransferError(error: unknown): string {
	if (!(error instanceof Error)) {
		return 'Something went wrong. Please try again.';
	}

	const message = error.message.toLowerCase();
	if (message.includes('notallowed') || message.includes('cancel')) {
		return 'Card tap was cancelled.';
	}
	if (message.includes('credential') || message.includes('passkey')) {
		return "This isn't the right card. Use the physical card linked to this mint.";
	}
	if (message.includes('locked')) {
		return error.message;
	}
	if (message.includes('unlock recipient') || message.includes('claimed by')) {
		return error.message;
	}
	if (message.includes('user rejected') || message.includes('rejected')) {
		return 'Wallet confirmation was cancelled.';
	}
	return error.message;
}
