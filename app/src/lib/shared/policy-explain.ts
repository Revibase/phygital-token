/** Plain-words lines for permission changes, naming programs and instructions where we know them. */
import { knownProgram, nameRule, toHex } from 'secure-signer/shared';
import type { RuleJson } from 'phygital-token-sdk';

import { formatTokenAmount } from './amount';
import { shortAddress } from './encoding';
import { periodLabel, sameOrigins, SOL, type CapDraft, type PolicyDraft } from './policy-draft';

export type AssetInfo = { symbol: string; decimals: number; icon?: string | null; name?: string };

export const programName = (id: string) =>
	knownProgram(id)?.name ?? `Unknown program ${shortAddress(id)}`;

const asRuleShape = (r: RuleJson) => ({
	selector: Array.from(r.selector.match(/../g) ?? [], (b) => parseInt(b, 16)),
	dataLength: r.dataLength,
	accountCount: r.accountCount,
	accounts: r.accounts ?? [],
	arguments: r.args ?? []
});

/** "Transfer checked", or a short description of a custom rule. */
export function ruleLabel(program: string, rule: RuleJson): string {
	const known = nameRule(program, asRuleShape(rule));
	if (known) return known.name;
	const extra = (rule.accounts?.length ?? 0) + (rule.args?.length ?? 0);
	return `Custom rule 0x${toHex(asRuleShape(rule).selector)}${extra ? ` with ${extra} check${extra === 1 ? '' : 's'}` : ''}`;
}

/** The checks a custom rule applies, one line each. */
export function ruleDetails(rule: RuleJson): string[] {
	const lines: string[] = [];
	if (rule.dataLength !== undefined) lines.push(`Data is exactly ${rule.dataLength} bytes`);
	if (rule.accountCount !== undefined) lines.push(`Uses exactly ${rule.accountCount} accounts`);
	for (const a of rule.accounts ?? []) {
		const who =
			a.key === undefined
				? 'any account'
				: a.key === 'wallet'
					? 'the accessory wallet'
					: shortAddress(a.key);
		const flags = [
			a.signer === true && 'signs',
			a.signer === false && "doesn't sign",
			a.writable === true && 'writable',
			a.writable === false && 'read-only'
		]
			.filter(Boolean)
			.join(', ');
		lines.push(
			`Account ${a.index} is ${who}${a.owner ? `, owned by ${programName(a.owner)}` : ''}${flags ? ` (${flags})` : ''}${a.data?.length ? `, with ${a.data.length} data check${a.data.length === 1 ? '' : 's'}` : ''}`
		);
	}
	for (const d of rule.args ?? []) {
		lines.push(
			d.bytes !== undefined
				? `Bytes at ${d.offset} equal 0x${d.bytes}`
				: `Number at ${d.offset} (${d.unsigned!.width}) ${d.unsigned!.is} ${d.unsigned!.value}`
		);
	}
	return lines;
}

export function limitPhrase(asset: string, cap: CapDraft, info: AssetInfo): string {
	const fmt = (v: bigint) => `${formatTokenAmount(v, info.decimals)} ${info.symbol}`;
	return `${fmt(cap.cap)} ${periodLabel(cap.windowSeconds)}${cap.maxPerTx > 0n ? `, at most ${fmt(cap.maxPerTx)} per tap` : ''}`;
}

export const SOL_INFO: AssetInfo = { symbol: 'SOL', decimals: 9, icon: '/solana.svg' };

/** `asset`'s loaded metadata, or what to show while it loads (or if it can't). */
export function assetInfoOr(
	infos: ReadonlyMap<string, AssetInfo> | undefined,
	asset: string
): AssetInfo {
	return (
		infos?.get(asset) ??
		(asset === SOL ? SOL_INFO : { symbol: shortAddress(asset), decimals: 0, icon: null })
	);
}

/** What replacing the draft with `next` changes, one line each (for "Paste permissions"). */
export function describeReplacement(
	current: PolicyDraft,
	next: PolicyDraft,
	assets: (asset: string) => AssetInfo
): string[] {
	const lines: string[] = [];
	for (const [id, p] of next.programs) {
		const before = current.programs.get(id);
		const what = p.kind === 'all' ? 'everything' : p.rules.map((r) => ruleLabel(id, r)).join(', ');
		if (!before) lines.push(`Allow ${programName(id)}: ${what}`);
		else if (JSON.stringify(before) !== JSON.stringify(p))
			lines.push(`Change ${programName(id)} to: ${what}`);
	}
	for (const id of current.programs.keys())
		if (!next.programs.has(id)) lines.push(`Stop allowing ${programName(id)}`);
	for (const [asset, cap] of next.limits) {
		const before = current.limits.get(asset);
		if (!before) lines.push(`Let taps spend up to ${limitPhrase(asset, cap, assets(asset))}`);
		else if (
			before.cap !== cap.cap ||
			before.windowSeconds !== cap.windowSeconds ||
			before.maxPerTx !== cap.maxPerTx
		) {
			lines.push(
				`Change the ${assets(asset).symbol} limit to ${limitPhrase(asset, cap, assets(asset))}`
			);
		}
	}
	for (const asset of current.limits.keys())
		if (!next.limits.has(asset)) lines.push(`Block spending ${assets(asset).symbol}`);
	if (!sameOrigins(current.origins, next.origins))
		lines.push(
			next.origins.length
				? `Only accept taps from ${next.origins.join(', ')}`
				: 'Accept taps from any site'
		);
	return lines;
}
