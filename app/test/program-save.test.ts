import { it, expect } from 'vitest';
import { address } from '@solana/kit';
import {
	cloneDraft,
	policyDiff,
	programSaveDraft,
	sameProgram,
	SOL,
	tapPaymentsPreset
} from '../src/lib/shared/policy-draft';
const system = address('11111111111111111111111111111111');
const token = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
it('saves only the reviewed program, preserving active limits and other programs', () => {
	const active = tapPaymentsPreset();
	const draft = cloneDraft(active);
	draft.programs.set(system, { kind: 'all' });
	draft.programs.delete(token);
	draft.limits.set(SOL, { cap: 999n, windowSeconds: 0n, maxPerTx: 0n });
	const next = programSaveDraft(active, draft, system);
	expect(next.programs.get(system)).toEqual({ kind: 'all' });
	expect(next.programs.get(token)).toEqual(active.programs.get(token));
	expect(next.limits).toEqual(active.limits);
	expect(policyDiff(active, next).map((a) => a.__kind)).toEqual(['SetProgramPermission']);
	expect(active.programs.get(system)?.kind).toBe('only');
});
it('reviews deletion as removal of just that program', () => {
	const active = tapPaymentsPreset();
	const draft = cloneDraft(active);
	draft.programs.delete(system);
	const next = programSaveDraft(active, draft, system);
	expect(policyDiff(active, next)).toEqual([
		{ __kind: 'RemoveProgramPermission', fields: [system] }
	]);
	expect(next.programs.get(token)).toEqual(active.programs.get(token));
});
it('has no transaction changes when the reviewed program is unchanged', () => {
	const active = tapPaymentsPreset();
	const draft = cloneDraft(active);
	draft.programs.delete(token);
	expect(policyDiff(active, programSaveDraft(active, draft, system))).toEqual([]);
});

it('ignores JSON property order and omitted empty checks when detecting program changes', () => {
	const before = { kind: 'only' as const, rules: [{ selector: '02000000' }] };
	const after = {
		kind: 'only' as const,
		rules: [{ accounts: [], args: [], selector: '02000000' }]
	};
	expect(sameProgram(system, before, after)).toBe(true);
	expect(sameProgram(system, before, { kind: 'all' })).toBe(false);
	expect(sameProgram(system, before, undefined)).toBe(false);
});
