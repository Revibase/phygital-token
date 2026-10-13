/**
 * The accessory's permissions (its on-chain `AccessoryPolicy`) as an editable
 * draft: spending limits per asset, the sites taps may come from, and allowed
 * programs, each for everything or only some instructions. `policyDiff` turns a draft into the fewest
 * `update_policy` actions. Rules are kept in the SDK's JSON form
 * (`RuleJson`), which round-trips the program's rules losslessly and is also
 * what the editor copies and pastes, and what permission requests carry.
 */
import { address, isSome, type Address } from '@solana/kit';
import {
	getProgramPermissionEncoder,
	isValidOrigin,
	parsePermissionSet,
	periodFromSeconds,
	periodSeconds,
	PermissionFormatError,
	ruleFromProgram,
	ruleToArgs,
	type AccessoryPolicy,
	type PermissionSet,
	type PolicyActionArgs,
	type ProgramPermissionArgs,
	type RuleJson,
	type SpendCap
} from 'phygital-token-sdk';

import { bytesEqual } from './encoding';
import {
	ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
	SYSTEM_PROGRAM_ADDRESS,
	TOKEN_2022_PROGRAM_ADDRESS,
	TOKEN_PROGRAM_ADDRESS
} from './programs';

export const DAY_SECONDS = 86_400n;
/** The limits' key for SOL; every other key is a mint address. */
export const SOL = 'SOL';

export type CapDraft = { cap: bigint; windowSeconds: bigint; maxPerTx: bigint };
export type ProgramDraft = { kind: 'all' } | { kind: 'only'; rules: RuleJson[] };
export type PolicyDraft = {
	/** `SOL` or a mint address → its limit. Anything without one can't be spent. */
	limits: Map<string, CapDraft>;
	programs: Map<Address, ProgramDraft>;
	/** Sites taps may come from; empty = any site. */
	origins: string[];
};

const only = (...selectors: string[]): ProgramDraft => ({
	kind: 'only',
	rules: selectors.map((selector) => ({ selector }))
});

/**
 * The tap-payments baseline: transfers only (System transfer, Token and
 * Token-2022 transfer / transferChecked, ATA create-if-missing). Limits start
 * empty: the owner fills in what taps may spend.
 */
export function tapPaymentsPreset(): PolicyDraft {
	return {
		limits: new Map(),
		origins: [],
		programs: new Map<Address, ProgramDraft>([
			[SYSTEM_PROGRAM_ADDRESS, only('02000000')],
			[TOKEN_PROGRAM_ADDRESS, only('03', '0c')],
			[TOKEN_2022_PROGRAM_ADDRESS, only('03', '0c')],
			[ASSOCIATED_TOKEN_PROGRAM_ADDRESS, only('01')]
		])
	};
}

/** Only label the exact transfer preset as payments; broader or constrained rules stay custom. */
export function isTapPaymentsDraft(draft: PolicyDraft): boolean {
	const preset = tapPaymentsPreset();
	if (draft.programs.size !== preset.programs.size) return false;
	try {
		return [...preset.programs].every(([id, expected]) => {
			const actual = draft.programs.get(id);
			return !!actual && samePermission(permissionArgs(id, expected), permissionArgs(id, actual));
		});
	} catch {
		return false;
	}
}

export const emptyDraft = (): PolicyDraft => ({
	limits: new Map(),
	programs: new Map(),
	origins: []
});

const capDraft = (cap: SpendCap): CapDraft => ({
	cap: cap.cap,
	windowSeconds: cap.windowSeconds,
	maxPerTx: cap.maxPerTx
});

export function draftFromPolicy(policy: AccessoryPolicy | null): PolicyDraft {
	if (!policy) return emptyDraft();
	const limits = new Map<string, CapDraft>();
	if (isSome(policy.solCap)) limits.set(SOL, capDraft(policy.solCap.value));
	for (const m of policy.mintCaps) limits.set(m.mint, capDraft(m.cap));
	const programs = new Map<Address, ProgramDraft>(
		policy.programPermissions.map((p) => [
			p.programId,
			p.access.__kind === 'AllInstructions'
				? { kind: 'all' }
				: { kind: 'only', rules: p.access.fields[0].map(ruleFromProgram) }
		])
	);
	return { limits, programs, origins: [...policy.allowedOrigins] };
}

export function cloneDraft(d: PolicyDraft): PolicyDraft {
	return {
		limits: new Map([...d.limits].map(([k, v]) => [k, { ...v }])),
		programs: new Map(
			[...d.programs].map(([k, v]) => [
				k,
				v.kind === 'all' ? v : { kind: 'only', rules: structuredClone(v.rules) }
			])
		),
		origins: [...d.origins]
	};
}

export function permissionArgs(programId: Address, p: ProgramDraft): ProgramPermissionArgs {
	return {
		programId,
		access:
			p.kind === 'all'
				? { __kind: 'AllInstructions' }
				: { __kind: 'Restricted', fields: [p.rules.map(ruleToArgs)] }
	};
}

const encoder = getProgramPermissionEncoder();
const samePermission = (a: ProgramPermissionArgs, b: ProgramPermissionArgs) =>
	bytesEqual(new Uint8Array(encoder.encode(a)), new Uint8Array(encoder.encode(b)));
/** Semantic equality: omitted empty checks and JSON key order don't make a draft dirty. */
export function sameProgram(
	id: Address,
	before: ProgramDraft | undefined,
	after: ProgramDraft | undefined
): boolean {
	if (!before || !after) return before === after;
	return samePermission(permissionArgs(id, before), permissionArgs(id, after));
}

const sameCap = (a: CapDraft, b: CapDraft) =>
	a.cap === b.cap && a.windowSeconds === b.windowSeconds && a.maxPerTx === b.maxPerTx;
/** Order doesn't matter to the program, so it doesn't make a draft dirty. */
export const sameOrigins = (a: string[], b: string[]) =>
	a.length === b.length && a.every((o) => b.includes(o));

/** The fewest actions turning `current` into `draft`. The program keeps what's been spent when a limit changes. */
export function policyDiff(current: PolicyDraft, draft: PolicyDraft): PolicyActionArgs[] {
	const actions: PolicyActionArgs[] = [];
	for (const [id, before] of current.programs) {
		const after = draft.programs.get(id);
		if (!after) actions.push({ __kind: 'RemoveProgramPermission', fields: [id] });
		else if (!sameProgram(id, before, after))
			actions.push({ __kind: 'SetProgramPermission', fields: [permissionArgs(id, after)] });
	}
	for (const [id, after] of draft.programs) {
		if (!current.programs.has(id))
			actions.push({ __kind: 'SetProgramPermission', fields: [permissionArgs(id, after)] });
	}

	const sol = draft.limits.get(SOL) ?? null;
	const solBefore = current.limits.get(SOL) ?? null;
	if (!sol && solBefore) actions.push({ __kind: 'SetSolCap', fields: [null] });
	if (sol && (!solBefore || !sameCap(sol, solBefore)))
		actions.push({ __kind: 'SetSolCap', fields: [sol] });

	for (const [mint, before] of current.limits) {
		if (mint === SOL) continue;
		const after = draft.limits.get(mint);
		if (!after) actions.push({ __kind: 'RemoveMintCap', fields: [address(mint)] });
		else if (!sameCap(before, after))
			actions.push({ __kind: 'SetMintCap', fields: [address(mint), after] });
	}
	for (const [mint, after] of draft.limits) {
		if (mint !== SOL && !current.limits.has(mint))
			actions.push({ __kind: 'SetMintCap', fields: [address(mint), after] });
	}
	if (!sameOrigins(current.origins, draft.origins))
		actions.push({ __kind: 'SetAllowedOrigins', fields: [draft.origins] });
	return actions;
}

/** Apply one reviewed program without including other pending edits. */
export function programSaveDraft(
	active: PolicyDraft,
	draft: PolicyDraft,
	id: Address
): PolicyDraft {
	const programs = new Map(active.programs);
	const permission = draft.programs.get(id);
	if (permission) programs.set(id, permission);
	else programs.delete(id);
	return { limits: new Map(active.limits), programs, origins: [...active.origins] };
}

/** The draft as a permission set: the format the editor copies and requests carry. */
export function draftToSet(d: PolicyDraft): PermissionSet {
	return {
		v: 1,
		programs: [...d.programs].map(([id, p]) => ({
			id,
			access: p.kind === 'all' ? 'all' : { only: p.rules }
		})),
		limits: [...d.limits].map(([asset, c]) => ({
			asset,
			amount: String(c.cap),
			period: periodFromSeconds(c.windowSeconds),
			...(c.maxPerTx > 0n ? { maxPerTap: String(c.maxPerTx) } : {})
		})),
		...(d.origins.length ? { origins: [...d.origins] } : {})
	};
}

/** `set` comes from `parsePermissionSet`, which already rejects repeated programs and overlapping rules. */
export function draftFromSet(set: PermissionSet): PolicyDraft {
	return {
		limits: new Map(
			set.limits.map((l) => [
				l.asset,
				{
					cap: BigInt(l.amount),
					windowSeconds: periodSeconds(l.period),
					maxPerTx: BigInt(l.maxPerTap ?? '0')
				}
			])
		),
		programs: new Map(
			set.programs.map((p) => [
				address(p.id),
				p.access === 'all' ? { kind: 'all' } : { kind: 'only', rules: p.access.only }
			])
		),
		origins: [...(set.origins ?? [])]
	};
}

/**
 * Checks the draft the way the program would, so a valid draft always saves.
 * Returns the first problem, or null. (Parsing the draft as a permission set
 * applies every on-chain rule check.)
 */
export function validateDraft(d: PolicyDraft): string | null {
	try {
		parsePermissionSet(JSON.parse(JSON.stringify(draftToSet(d))));
		return null;
	} catch (err) {
		if (err instanceof PermissionFormatError) return err.message;
		throw err;
	}
}

/**
 * What someone typed as a site (`app.example.com`, a full URL with a path…) as
 * the exact origin a browser signs, or null if it can't be one.
 */
export function toOrigin(input: string): string | null {
	const text = input.trim();
	if (!text) return null;
	try {
		const { origin } = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
		return isValidOrigin(origin) ? origin : null;
	} catch {
		return null;
	}
}

export const PERIODS: { label: string; seconds: bigint }[] = [
	{ label: 'a day', seconds: DAY_SECONDS },
	{ label: 'a week', seconds: 604_800n },
	{ label: 'a month', seconds: 2_592_000n },
	{ label: 'in total', seconds: 0n }
];

export function periodLabel(seconds: bigint): string {
	return (
		PERIODS.find((p) => p.seconds === seconds)?.label ??
		(seconds % DAY_SECONDS === 0n ? `every ${seconds / DAY_SECONDS} days` : `every ${seconds}s`)
	);
}
