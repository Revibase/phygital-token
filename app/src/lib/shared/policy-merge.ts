/**
 * Merges a permission request into the owner's current permissions with the
 * smallest change: it only adds or widens, never removes or narrows, and skips
 * anything the owner already allows. A request's sites only matter when the
 * owner already limits taps to some sites: they're added to that list. Each
 * change is listed so the review screen can explain it.
 */
import { address, type Address } from '@solana/kit';
import { periodSeconds, type PermissionSet, type RuleJson } from 'phygital-token-sdk';

import { cloneDraft, type CapDraft, type PolicyDraft } from './policy-draft';

export type Change =
	| { kind: 'addProgram'; program: Address; access: 'all' | RuleJson[]; reason?: string }
	| { kind: 'widenProgram'; program: Address; reason?: string }
	| { kind: 'addRules'; program: Address; rules: RuleJson[]; reason?: string }
	| { kind: 'addLimit'; asset: string; cap: CapDraft }
	| { kind: 'raiseLimit'; asset: string; from: CapDraft; to: CapDraft }
	| { kind: 'addOrigins'; origins: string[] };

const ANY = Symbol('any');

const checks = (rule: RuleJson) => [
	...(rule.accounts ?? []).map((a) => JSON.stringify(a)),
	...(rule.args ?? []).map((a) => `arg:${JSON.stringify(a)}`)
];

/**
 * `existing` allows everything `requested` does: its selector is a prefix of
 * the requested one, its lengths are unset or equal, and each of its checks is
 * also one of the requested rule's.
 */
export function ruleCovers(existing: RuleJson, requested: RuleJson): boolean {
	const lengthOk = (a: number | undefined, b: number | undefined) => a === undefined || a === b;
	if (!requested.selector.startsWith(existing.selector)) return false;
	if (
		!lengthOk(existing.dataLength, requested.dataLength) ||
		!lengthOk(existing.accountCount, requested.accountCount)
	)
		return false;
	const wanted = new Set(checks(requested));
	return checks(existing).every((c) => wanted.has(c));
}

/** Unlimited per tap (0) beats any number. */
const perTap = (v: bigint) => (v === 0n ? ANY : v);
const morePermissivePerTap = (a: bigint, b: bigint) =>
	perTap(a) === ANY || perTap(b) === ANY ? 0n : a > b ? a : b;

export function mergeRequest(
	current: PolicyDraft,
	request: PermissionSet
): { draft: PolicyDraft; changes: Change[] } {
	const draft = cloneDraft(current);
	const changes: Change[] = [];

	for (const p of request.programs) {
		const id = address(p.id);
		const have = draft.programs.get(id);
		const reason = p.reason;
		if (!have) {
			draft.programs.set(
				id,
				p.access === 'all' ? { kind: 'all' } : { kind: 'only', rules: [...p.access.only] }
			);
			changes.push({
				kind: 'addProgram',
				program: id,
				access: p.access === 'all' ? 'all' : p.access.only,
				...(reason ? { reason } : {})
			});
		} else if (have.kind === 'all') {
			continue;
		} else if (p.access === 'all') {
			draft.programs.set(id, { kind: 'all' });
			changes.push({ kind: 'widenProgram', program: id, ...(reason ? { reason } : {}) });
		} else {
			const missing = p.access.only.filter((r) => !have.rules.some((e) => ruleCovers(e, r)));
			if (missing.length) {
				have.rules.push(...missing);
				changes.push({
					kind: 'addRules',
					program: id,
					rules: missing,
					...(reason ? { reason } : {})
				});
			}
		}
	}

	for (const l of request.limits) {
		const want: CapDraft = {
			cap: BigInt(l.amount),
			windowSeconds: periodSeconds(l.period),
			maxPerTx: BigInt(l.maxPerTap ?? '0')
		};
		const have = draft.limits.get(l.asset);
		if (!have) {
			draft.limits.set(l.asset, want);
			changes.push({ kind: 'addLimit', asset: l.asset, cap: want });
			continue;
		}
		const covered =
			(have.windowSeconds === want.windowSeconds ||
				(have.windowSeconds > 0n &&
					(want.windowSeconds === 0n || have.windowSeconds < want.windowSeconds))) &&
			have.cap >= want.cap &&
			(have.maxPerTx === 0n || (want.maxPerTx !== 0n && have.maxPerTx >= want.maxPerTx));
		if (covered) continue;
		const to: CapDraft = {
			cap: have.cap > want.cap ? have.cap : want.cap,
			windowSeconds:
				have.windowSeconds === 0n
					? want.windowSeconds
					: want.windowSeconds === 0n
						? have.windowSeconds
						: have.windowSeconds < want.windowSeconds
							? have.windowSeconds
							: want.windowSeconds,
			maxPerTx: morePermissivePerTap(have.maxPerTx, want.maxPerTx)
		};
		draft.limits.set(l.asset, to);
		changes.push({ kind: 'raiseLimit', asset: l.asset, from: have, to });
	}

	// An empty list already allows every site.
	const newOrigins = draft.origins.length
		? (request.origins ?? []).filter((o) => !draft.origins.includes(o))
		: [];
	if (newOrigins.length) {
		draft.origins.push(...newOrigins);
		changes.push({ kind: 'addOrigins', origins: newOrigins });
	}
	return { draft, changes };
}
