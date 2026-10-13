export const SOL_DECIMALS = 9;

export function formatTokenAmount(raw: bigint, decimals: number): string {
	const negative = raw < 0n;
	const abs = negative ? -raw : raw;
	const base = 10n ** BigInt(decimals);
	const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	const formatted = frac ? `${abs / base}.${frac}` : `${abs / base}`;
	return negative ? `-${formatted}` : formatted;
}

/** Display form: thousands separators, fraction truncated (2 digits ≥ 1000, 4 ≥ 1, else 6). */
export function formatCompactTokenAmount(raw: bigint, decimals: number): string {
	const [whole, frac = ''] = formatTokenAmount(raw, decimals).split('.');
	const digits = whole.replace('-', '').length > 3 ? 2 : whole !== '0' && whole !== '-0' ? 4 : 6;
	const kept = frac.slice(0, digits).replace(/0+$/, '');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	if (!kept && frac && whole === '0') return `<0.${'0'.repeat(digits - 1)}1`;
	return kept ? `${grouped}.${kept}` : grouped;
}

export function sanitizeDecimalInput(raw: string): string {
	const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
	const dot = cleaned.indexOf('.');
	return dot === -1
		? cleaned
		: `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;
}

/** Throws on empty, zero, malformed or over-precise input. */
export function uiAmountToRaw(uiAmount: string, decimals: number): bigint {
	const trimmed = uiAmount.trim();
	if (!/^\d*\.?\d*$/.test(trimmed) || !/\d/.test(trimmed)) throw new Error('Enter an amount.');
	const [whole = '', frac = ''] = trimmed.split('.');
	if (frac.length > decimals) throw new Error(`This token supports at most ${decimals} decimals.`);
	const raw =
		BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
	if (raw === 0n) throw new Error('Enter an amount.');
	return raw;
}
