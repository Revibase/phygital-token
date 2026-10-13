import { it, expect } from 'vitest';
import { address } from '@solana/kit';
import { validateDraft } from '../src/lib/shared/policy-draft';
import type { RuleJson } from 'phygital-token-sdk';
const id = address('11111111111111111111111111111111');
const draft = (rules: RuleJson[]) => ({
	limits: new Map(),
	origins: [],
	programs: new Map([[id, { kind: 'only' as const, rules }]])
});
it('rejects two rules for one instruction, as the program would', () => {
	expect(
		validateDraft(draft([{ selector: '02000000' }, { selector: '02000000', accountCount: 2 }]))
	).toContain('same instruction');
	expect(validateDraft(draft([{ selector: '02' }, { selector: '02000000' }]))).toContain(
		'same instruction'
	);
});
it('allows different instructions in one program', () => {
	expect(validateDraft(draft([{ selector: '02000000' }, { selector: '03000000' }]))).toBeNull();
});
