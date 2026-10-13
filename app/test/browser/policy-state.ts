/** Browser-local policy state for the click-through sandbox. Never bundled in production. */
import { address, createNoopSigner } from '@solana/kit';
import type { PolicyActionArgs } from 'phygital-token-sdk';
import { buildPolicyInstruction } from '../../src/lib/shared/wallet-instructions';
import {
	getAccessoryPolicyDecoder,
	getAccessoryPolicyEncoder,
	parsePermissionSet,
	parsePhygitalTokenInstruction,
	PhygitalTokenInstruction,
	ruleFromProgram,
	ruleToArgs,
	type AccessoryPolicy
} from 'phygital-token-sdk';
import { draftFromPolicy, draftFromSet, draftToSet, SOL } from '../../src/lib/shared/policy-draft';
import { accessory, OWNER, WALLET, walletPolicy } from './fixtures';
import type { OwnerAction } from '../../src/lib/client/accessory-wallet/submit';

const KEY = 'simulation:policy';
export async function fetchAccessoryPolicy() {
	const saved = localStorage.getItem(KEY);
	if (saved === 'off') return null;
	if (!saved)
		return (
			document.cookie.includes('simulation_policy=small')
				? walletPolicy(1_000_000n)
				: document.cookie.includes('simulation_policy=on')
					? walletPolicy()
					: null
		) as AccessoryPolicy | null;
	const draft = draftFromSet(parsePermissionSet(JSON.parse(saved)));
	const now = BigInt(Math.floor(Date.now() / 1000));
	const cap = (value: { cap: bigint; windowSeconds: bigint; maxPerTx: bigint }) => ({
		...value,
		remaining: value.cap,
		lastReset: value.windowSeconds ? now - (now % value.windowSeconds) : now
	});
	const sol = draft.limits.get(SOL);
	return getAccessoryPolicyDecoder().decode(
		getAccessoryPolicyEncoder().encode({
			phygitalToken: address(accessory.pda),
			wallet: address(WALLET),
			solCap: sol ? cap(sol) : null,
			mintCaps: [...draft.limits]
				.filter(([id]) => id !== SOL)
				.map(([id, value]) => ({ mint: address(id), cap: cap(value) })),
			allowedOrigins: draft.origins,
			programPermissions: [...draft.programs].map(([id, value]) => ({
				programId: id,
				access:
					value.kind === 'all'
						? { __kind: 'AllInstructions' as const }
						: { __kind: 'Restricted' as const, fields: [value.rules.map(ruleToArgs)] as const }
			}))
		})
	);
}
export async function submitAsOwner(_context: unknown, action: OwnerAction) {
	if (localStorage.getItem('simulation:clickthrough') !== 'true')
		throw new Error('Signing must be simulated explicitly');
	const owner = createNoopSigner(address(OWNER));
	const instructions = await action.build(owner, owner, 0n);
	const draft = draftFromPolicy(await fetchAccessoryPolicy());
	for (const instruction of instructions) {
		if (!instruction.data) throw new Error('Missing preview instruction data');
		const parsed = parsePhygitalTokenInstruction({ ...instruction, data: instruction.data });
		if (parsed.instructionType === PhygitalTokenInstruction.ClosePolicy) {
			localStorage.setItem(KEY, 'off');
			continue;
		}
		if (parsed.instructionType !== PhygitalTokenInstruction.UpdatePolicy)
			throw new Error('This preview simulates permission changes only');
		for (const change of parsed.data.actions) {
			switch (change.__kind) {
				case 'SetSolCap':
					if (change.fields[0].__option === 'Some') draft.limits.set(SOL, change.fields[0].value);
					else draft.limits.delete(SOL);
					break;
				case 'SetMintCap':
					draft.limits.set(change.fields[0], change.fields[1]);
					break;
				case 'RemoveMintCap':
					draft.limits.delete(change.fields[0]);
					break;
				case 'SetAllowedOrigins':
					draft.origins = [...change.fields[0]];
					break;
				case 'SetProgramPermission': {
					const p = change.fields[0];
					draft.programs.set(
						p.programId,
						p.access.__kind === 'AllInstructions'
							? { kind: 'all' }
							: { kind: 'only', rules: p.access.fields[0].map(ruleFromProgram) }
					);
					break;
				}
				case 'RemoveProgramPermission':
					draft.programs.delete(change.fields[0]);
					break;
			}
		}
		localStorage.setItem(KEY, JSON.stringify(draftToSet(draft)));
	}
	return 'simulated-policy-save';
}

export function savePolicy(ctx: unknown, pda: string, actions: PolicyActionArgs[] | 'close') {
	return submitAsOwner(ctx, {
		pda,
		build: async (owner, payer) => [
			await buildPolicyInstruction(owner, address(pda), actions, payer)
		]
	} as OwnerAction);
}
