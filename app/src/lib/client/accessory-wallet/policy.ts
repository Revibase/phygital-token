import { address } from '@solana/kit';
import {
	fetchMaybeAccessoryPolicy,
	findPolicyPda,
	type AccessoryPolicy,
	type PolicyActionArgs
} from 'phygital-token-sdk';

import { buildPolicyInstruction } from '$lib/shared/wallet-instructions';
import { browserRpc } from '../rpc';
import type { SigningContext } from '../wallet/wallet.svelte';
import { confirmAsOwner } from './submit';

export async function fetchAccessoryPolicy(pda: string): Promise<AccessoryPolicy | null> {
	const [policy] = await findPolicyPda({ phygitalToken: address(pda) });
	const account = await fetchMaybeAccessoryPolicy(browserRpc(), policy, {
		commitment: 'confirmed'
	});
	return account.exists ? account.data : null;
}

/** Applies `actions` to the accessory's tap policy (or closes it) and waits for it to land. */
export function savePolicy(
	ctx: SigningContext,
	pda: string,
	actions: PolicyActionArgs[] | 'close'
): Promise<string> {
	return confirmAsOwner(ctx, {
		pda,
		...(actions !== 'close' ? { growsPolicy: true } : {}),
		build: async (owner, payer) => [
			await buildPolicyInstruction(owner, address(pda), actions, payer)
		]
	});
}
