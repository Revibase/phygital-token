/**
 * Warnings for permission changes, so owners notice what could hurt them.
 * Danger needs an explicit "I understand the risk" before approving.
 */
import { knownProgram, ruleRisk } from 'secure-signer/shared';
import { TOKEN_PROGRAMS } from './programs';
import type { RuleJson } from 'phygital-token-sdk';

import type { Change } from './policy-merge';
import { DAY_SECONDS } from './policy-draft';
import { programName } from './policy-explain';

export type RiskLevel = 'danger' | 'caution';
export type Risk = { level: RiskLevel; message: string };

export type RiskContext = {
	/** True when the program's developer can still change it; undefined when unknown. */
	upgradeable: (program: string) => boolean | undefined;
	/** What the accessory wallet holds of an asset now (raw units); undefined when unknown. */
	holding: (asset: string) => bigint | undefined;
};

/** Protections the program enforces whatever the permissions say, shown so owners don't over-worry. */
export const ALWAYS_ENFORCED = [
	'Spending limits count every SOL and token leaving the accessory wallet, whichever program moves it.',
	'Taps can never leave a delegate on a token account, or change who controls one.',
	'You can turn tap permissions off, or change them, at any time.'
];

const ruleShape = (r: RuleJson) => ({
	selector: Array.from(r.selector.match(/../g) ?? [], (b) => parseInt(b, 16)),
	dataLength: r.dataLength,
	accountCount: r.accountCount,
	accounts: r.accounts ?? [],
	arguments: r.args ?? []
});

function programRisks(
	program: string,
	everything: boolean,
	rules: RuleJson[],
	ctx: RiskContext
): Risk[] {
	const risks: Risk[] = [];
	const known = knownProgram(program);
	const name = programName(program);
	if (everything && (!known?.metered || TOKEN_PROGRAMS.has(program))) {
		risks.push({
			level: 'danger',
			message: TOKEN_PROGRAMS.has(program)
				? `Everything on ${name} includes burning tokens and closing token accounts.`
				: `${name} could do anything it's able to with the accessory wallet. Only allow this for a program you trust completely.`
		});
	}
	for (const rule of rules) {
		const risk = ruleRisk(program, ruleShape(rule).selector);
		if (risk) risks.push({ level: 'danger', message: risk });
	}
	if (!known)
		risks.push({
			level: 'caution',
			message: `${name} isn't one we recognise. Only allow programs from projects you trust.`
		});
	if (ctx.upgradeable(program))
		risks.push({
			level: 'caution',
			message: `${name}'s developer can change what it does at any time.`
		});
	if (ctx.upgradeable(program) === undefined)
		risks.push({
			level: 'caution',
			message: `${name}: we couldn’t verify whether its developer can change it.`
		});
	return risks;
}

export function changeRisks(change: Change, ctx: RiskContext): Risk[] {
	switch (change.kind) {
		case 'addProgram':
			return programRisks(
				change.program,
				change.access === 'all',
				change.access === 'all' ? [] : change.access,
				ctx
			);
		case 'widenProgram':
			return programRisks(change.program, true, [], ctx);
		case 'addRules':
			return programRisks(change.program, false, change.rules, ctx);
		case 'addLimit':
		case 'raiseLimit': {
			const cap = change.kind === 'addLimit' ? change.cap : change.to;
			const risks: Risk[] =
				change.kind === 'raiseLimit'
					? [{ level: 'caution', message: 'This raises a limit you already set.' }]
					: [];
			const held = ctx.holding(change.asset);
			if (held !== undefined && cap.cap > held) {
				const longWindow = cap.windowSeconds === 0n || cap.windowSeconds >= 7n * DAY_SECONDS;
				risks.push({
					level: longWindow ? 'danger' : 'caution',
					message:
						'This is more than the accessory wallet holds now, so taps could spend all of it.'
				});
			}
			return risks;
		}
		case 'addOrigins':
			return [
				{
					level: 'caution',
					message: 'These sites could ask your accessory to sign. Only add sites you trust.'
				}
			];
	}
}

/** Warnings about the request itself. */
export function requestRisks(source: { site: string | null }): Risk[] {
	return source.site
		? []
		: [
				{
					level: 'caution',
					message:
						'This came from a link, not from a site we could check. Make sure you trust whoever sent it.'
				}
			];
}

export const hasDanger = (risks: Risk[]) => risks.some((r) => r.level === 'danger');
