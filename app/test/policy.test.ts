import { describe, expect, it } from 'vitest';
import { address, none, some } from '@solana/kit';
import type { AccessoryPolicy, RuleJson } from 'phygital-token-sdk';

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
	type PolicyDraft
} from '$lib/shared/policy-draft';
import { ruleLabel } from '$lib/shared/policy-explain';

const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = address('11111111111111111111111111111111');
const STAKE = address('Stake11111111111111111111111111111111111111');
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

describe('naming rules', () => {
	it('names known instructions in plain words', () => {
		expect(ruleLabel(TOKEN, { selector: '0c' })).toBe('Transfer checked');
		expect(ruleLabel(TOKEN, custom)).toBe('Custom rule 0x0c with 2 checks');
	});
});

describe('allowed sites', () => {
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
