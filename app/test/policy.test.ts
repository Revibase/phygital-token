import { describe, expect, it } from 'vitest';
import { address, none, some, type Address } from '@solana/kit';
import type { AccessoryPolicy, PermissionSet, RuleJson } from 'phygital-token-sdk';

import {
	DAY_SECONDS,
	isTapPaymentsDraft,
	draftFromPolicy,
	draftFromSet,
	draftToSet,
	emptyDraft,
	policyDiff,
	SOL,
	tapPaymentsPreset,
	toOrigin,
	validateDraft,
	type PolicyDraft,
	type ProgramDraft
} from '$lib/shared/policy-draft';
import { mergeRequest, ruleCovers } from '$lib/shared/policy-merge';
import { explainChange, ruleLabel, SOL_INFO } from '$lib/shared/policy-explain';
import { changeRisks, hasDanger, requestRisks, type RiskContext } from '$lib/shared/policy-risk';

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = address('11111111111111111111111111111111');
const STAKE = address('Stake11111111111111111111111111111111111111');
const UNKNOWN = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const day = (cap: bigint, maxPerTx = 0n) => ({ cap, windowSeconds: DAY_SECONDS, maxPerTx });
const custom: RuleJson = {
	selector: '0c',
	accounts: [{ index: 0, key: 'wallet' }],
	args: [{ offset: 1, unsigned: { width: 'u64', is: 'le', value: '100' } }]
};

const policy = (over: Partial<AccessoryPolicy> = {}): AccessoryPolicy => ({
	discriminator: new Uint8Array(8),
	phygitalToken: TOKEN,
	wallet: SYSTEM,
	solCap: none(),
	mintCaps: [],
	allowedOrigins: [],
	programPermissions: [],
	...over
});
const spend = (cap: bigint, remaining = cap, lastReset = 0n) => ({
	cap,
	remaining,
	lastReset,
	windowSeconds: DAY_SECONDS,
	maxPerTx: 0n
});

describe('policy draft', () => {
	it('the tap-payments preset allows transfers only, with no limits yet', () => {
		const preset = tapPaymentsPreset();
		expect(preset.limits.size).toBe(0);
		expect([...preset.programs.values()].every((p) => p.kind === 'only')).toBe(true);
		expect(preset.programs.get(TOKEN)).toEqual({
			kind: 'only',
			rules: [{ selector: '03' }, { selector: '0c' }]
		});
		expect(validateDraft(preset)).toBeNull();
	});

	it('diffs to the fewest actions, and nothing when unchanged', () => {
		const current = draftFromPolicy(
			policy({
				solCap: some(spend(5n, 2n)),
				mintCaps: [{ mint: address(USDC), cap: spend(7n) }],
				programPermissions: [{ programId: SYSTEM, access: { __kind: 'AllInstructions' } }]
			})
		);
		expect(policyDiff(current, current)).toEqual([]);
		const next: PolicyDraft = {
			origins: [],
			limits: new Map([[SOL, day(5n, 1n)]]),
			programs: new Map([[TOKEN, { kind: 'only', rules: [custom] }]])
		};
		const actions = policyDiff(current, next);
		expect(actions.map((a) => a.__kind)).toEqual([
			'RemoveProgramPermission',
			'SetProgramPermission',
			'SetSolCap',
			'RemoveMintCap'
		]);
		expect(policyDiff(next, next)).toEqual([]);
	});

	it('round-trips custom rules losslessly through the policy and the JSON format', () => {
		const draft: PolicyDraft = {
			origins: [],
			limits: new Map([[USDC, { cap: 9n, windowSeconds: 604_800n, maxPerTx: 3n }]]),
			programs: new Map([[TOKEN, { kind: 'only', rules: [custom] }]])
		};
		expect(draftFromSet(draftToSet(draft))).toEqual(draft);
		expect(draftToSet(draft).limits).toEqual([
			{ asset: USDC, amount: '9', period: 'week', maxPerTap: '3' }
		]);
	});

	it('validates the way the program does', () => {
		expect(validateDraft({ ...emptyDraft(), limits: new Map([[SOL, day(5n, 9n)]]) })).toMatch(
			/more than the amount/
		);
		expect(
			validateDraft({ ...emptyDraft(), programs: new Map([[TOKEN, { kind: 'only', rules: [] }]]) })
		).toMatch(/at least one rule/);
		expect(
			validateDraft({
				...emptyDraft(),
				programs: new Map([[TOKEN, { kind: 'only', rules: [{ selector: '0102', dataLength: 1 }] }]])
			})
		).toMatch(/shorter/);
	});
});

describe('merging a permission request', () => {
	const request = (over: Partial<PermissionSet> = {}): PermissionSet => ({
		v: 1,
		programs: [],
		limits: [],
		...over
	});

	it('adds only what is missing, and nothing when everything is already allowed', () => {
		const current = tapPaymentsPreset();
		current.limits.set(SOL, day(1_000_000_000n));
		const ask = request({
			programs: [
				{ id: TOKEN, access: { only: [{ selector: '0c' }, { selector: '04' }] } },
				{ id: STAKE, access: { only: [{ selector: '02000000' }] }, reason: 'Stake your NFT' }
			],
			limits: [{ asset: SOL, amount: '500000000', period: 'day' }]
		});
		const { draft, changes } = mergeRequest(current, ask);
		expect(changes).toEqual([
			{ kind: 'addRules', program: TOKEN, rules: [{ selector: '04' }] },
			{
				kind: 'addProgram',
				program: STAKE,
				access: [{ selector: '02000000' }],
				reason: 'Stake your NFT'
			}
		]);
		expect(policyDiff(current, draft)).toHaveLength(2);
		expect(mergeRequest(draft, ask).changes).toEqual([]);
	});

	it('never narrows: an existing "everything" stays, and a broader existing rule covers a narrower request', () => {
		const current: PolicyDraft = {
			origins: [],
			limits: new Map(),
			programs: new Map<Address, ProgramDraft>([
				[SYSTEM, { kind: 'all' }],
				[TOKEN, { kind: 'only', rules: [{ selector: '0c' }] }]
			])
		};
		expect(
			mergeRequest(
				current,
				request({
					programs: [
						{ id: SYSTEM, access: { only: [{ selector: '02000000' }] } },
						{ id: TOKEN, access: { only: [custom] } }
					]
				})
			).changes
		).toEqual([]);
		expect(ruleCovers({ selector: '0c' }, custom)).toBe(true);
		expect(ruleCovers(custom, { selector: '0c' })).toBe(false);
	});

	it('treats longer-period requests already covered by a daily allowance as no-ops', () => {
		const current: PolicyDraft = {
			origins: [],
			limits: new Map([[SOL, day(10n)]]),
			programs: new Map()
		};
		for (const period of ['week', 'lifetime'] as const) {
			expect(
				mergeRequest(current, request({ limits: [{ asset: SOL, amount: '5', period }] })).changes
			).toEqual([]);
		}
	});

	it('keeps a shorter existing reset window when a request asks for a longer one', () => {
		const current: PolicyDraft = {
			origins: [],
			limits: new Map([[SOL, day(10n)]]),
			programs: new Map()
		};
		const merged = mergeRequest(
			current,
			request({ limits: [{ asset: SOL, amount: '20', period: 'week' }] })
		);
		expect(merged.draft.limits.get(SOL)).toEqual(day(20n));
	});

	it('flags widening to everything and raising a limit, field by field', () => {
		const current: PolicyDraft = {
			origins: [],
			limits: new Map([[USDC, day(10n, 2n)]]),
			programs: new Map([[STAKE, { kind: 'only', rules: [{ selector: '02000000' }] }]])
		};
		const { changes } = mergeRequest(
			current,
			request({
				programs: [{ id: STAKE, access: 'all' }],
				limits: [{ asset: USDC, amount: '5', period: 'day', maxPerTap: '5' }]
			})
		);
		expect(changes).toEqual([
			{ kind: 'widenProgram', program: STAKE },
			{ kind: 'raiseLimit', asset: USDC, from: day(10n, 2n), to: day(10n, 5n) }
		]);
	});
});

describe('explaining and warning', () => {
	const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({
		upgradeable: () => false,
		holding: () => undefined,
		...over
	});
	const usdc = () => ({ symbol: 'USDC', decimals: 6 });

	it('names known programs and instructions in plain words', () => {
		expect(ruleLabel(TOKEN, { selector: '0c' })).toBe('Transfer checked');
		expect(ruleLabel(TOKEN, custom)).toBe('Custom rule 0x0c with 2 checks');
		expect(
			explainChange(
				{ kind: 'addProgram', program: STAKE, access: [{ selector: '02000000' }] },
				usdc
			).title
		).toBe('Allow Stake Program to: Delegate stake');
		expect(
			explainChange({ kind: 'addLimit', asset: USDC, cap: day(10_000_000n, 1_000_000n) }, usdc)
				.title
		).toBe('Let taps spend up to 10 USDC a day, at most 1 USDC per tap');
		expect(
			explainChange(
				{ kind: 'raiseLimit', asset: SOL, from: day(100_000_000n), to: day(500_000_000n) },
				() => SOL_INFO
			).title
		).toBe('Raise the SOL limit from 0.1 SOL a day to 0.5 SOL a day');
		expect(
			explainChange({ kind: 'addProgram', program: UNKNOWN, access: 'all' }, usdc).title
		).toMatch(/^Allow Unknown program 9xQe…VFin to do everything$/);
	});

	it('warns: danger for everything on unknown or token programs and risky instructions, caution otherwise', () => {
		expect(
			hasDanger(changeRisks({ kind: 'addProgram', program: UNKNOWN, access: 'all' }, ctx()))
		).toBe(true);
		expect(
			hasDanger(changeRisks({ kind: 'addProgram', program: TOKEN, access: 'all' }, ctx()))
		).toBe(true);
		expect(
			hasDanger(changeRisks({ kind: 'addProgram', program: SYSTEM, access: 'all' }, ctx()))
		).toBe(false);
		expect(
			hasDanger(
				changeRisks({ kind: 'addRules', program: TOKEN, rules: [{ selector: '04' }] }, ctx())
			)
		).toBe(true);
		const unknownOnly = changeRisks(
			{ kind: 'addProgram', program: UNKNOWN, access: [{ selector: '01' }] },
			ctx({ upgradeable: () => true })
		);
		expect(unknownOnly.map((r) => r.level)).toEqual(['caution', 'caution']);
		expect(unknownOnly[1].message).toMatch(/can change what it does/);
	});

	it('warns about limits above what the wallet holds, and links from unverified sources', () => {
		const held = ctx({ holding: () => 5n });
		expect(
			changeRisks(
				{ kind: 'addLimit', asset: SOL, cap: { cap: 10n, windowSeconds: 0n, maxPerTx: 0n } },
				held
			)[0].level
		).toBe('danger');
		expect(changeRisks({ kind: 'addLimit', asset: SOL, cap: day(10n) }, held)[0].level).toBe(
			'caution'
		);
		expect(changeRisks({ kind: 'addLimit', asset: SOL, cap: day(1n) }, held)).toEqual([]);
		expect(requestRisks({ site: null })).toHaveLength(1);
		expect(requestRisks({ site: 'stake.example' })).toEqual([]);
	});
});

describe('allowed sites', () => {
	const request = (origins: string[]): PermissionSet => ({
		v: 1,
		programs: [],
		limits: [],
		origins
	});

	it('turns what an owner types into the origin a browser signs', () => {
		expect(toOrigin('app.example.com')).toBe('https://app.example.com');
		expect(toOrigin(' https://App.Example.com/play?x=1 ')).toBe('https://app.example.com');
		expect(toOrigin('https://app.example.com:443')).toBe('https://app.example.com');
		expect(toOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
		expect(toOrigin('http://app.example.com')).toBeNull();
		expect(toOrigin('not a site')).toBeNull();
		expect(toOrigin('')).toBeNull();
	});

	it('round-trips through the policy and permission set, and saves only real changes', () => {
		const current = draftFromPolicy(
			policy({ allowedOrigins: ['https://a.example', 'https://b.example'] })
		);
		expect(current.origins).toEqual(['https://a.example', 'https://b.example']);
		expect(
			policyDiff(current, { ...current, origins: ['https://b.example', 'https://a.example'] })
		).toEqual([]);
		expect(policyDiff(current, { ...current, origins: [] })).toEqual([
			{ __kind: 'SetAllowedOrigins', fields: [[]] }
		]);
		expect(draftFromSet(draftToSet(current)).origins).toEqual(current.origins);
		expect(draftToSet(emptyDraft())).not.toHaveProperty('origins');
	});

	it('adds a request’s sites only when the owner already limits sites', () => {
		const anySite = mergeRequest(emptyDraft(), request(['https://game.example']));
		expect(anySite.draft.origins).toEqual([]);
		expect(anySite.changes).toEqual([]);

		const limited = mergeRequest(
			{ ...emptyDraft(), origins: ['https://a.example'] },
			request(['https://a.example', 'https://game.example'])
		);
		expect(limited.draft.origins).toEqual(['https://a.example', 'https://game.example']);
		expect(limited.changes).toEqual([{ kind: 'addOrigins', origins: ['https://game.example'] }]);
		expect(explainChange(limited.changes[0], () => SOL_INFO).title).toBe(
			'Also accept taps from https://game.example'
		);
		expect(changeRisks(limited.changes[0], {} as RiskContext)[0].level).toBe('caution');
	});
});

describe('plain-language payment mode', () => {
	it('recognizes payments independently of the spending budget', () => {
		const draft = tapPaymentsPreset();
		draft.limits.set(SOL, day(100n, 10n));
		expect(isTapPaymentsDraft(draft)).toBe(true);
	});
	it('does not describe broad, extra, constrained or invalid actions as ordinary payments', () => {
		for (const change of [
			(d: PolicyDraft) => d.programs.set(SYSTEM, { kind: 'all' }),
			(d: PolicyDraft) => d.programs.set(STAKE, { kind: 'all' }),
			(d: PolicyDraft) => d.programs.set(TOKEN, { kind: 'only', rules: [custom] }),
			(d: PolicyDraft) => d.programs.set(SYSTEM, { kind: 'only', rules: [{ selector: 'zz' }] })
		]) {
			const draft = tapPaymentsPreset();
			change(draft);
			expect(isTapPaymentsDraft(draft)).toBe(false);
		}
	});
});
