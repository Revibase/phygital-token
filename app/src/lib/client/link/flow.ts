import { address } from '@solana/kit';
import {
	authenticatePasskeyForTransfer,
	beginTransfer,
	getRemoveOwnerInstruction,
	getPolicyCloseAccounts
} from 'phygital-token-sdk';

import {
	buildLinkInstructions,
	LINK_COMPUTE_UNIT_LIMIT,
	linkExpectation,
	TAP_WINDOW_MS,
	validateLinkTransaction,
	type LinkTap
} from '$lib/shared/link-transaction';
import { browserRpc } from '../rpc';
import type { SigningContext } from '../wallet/wallet.svelte';
import { confirmAsOwner, submitAsOwner, type OwnerAction } from '../accessory-wallet/submit';
import { waitForConfirmation } from '../tx';
import { forgetWalletAccessories, refreshAccessory } from '../cache';

/** A slot-bound transfer challenge, and when a tap over it stops being usable. */
export type PreparedTap = Pick<LinkTap, 'session'> & { expiresAt: number };

/** Fetch before the click: iOS WebAuthn requires a user gesture without a network await. */
export async function prepareTap(secp256r1Pubkey: string, rpId: string): Promise<PreparedTap> {
	const fetchedAt = Date.now();
	const session = await beginTransfer({ rpc: browserRpc(), secp256r1Pubkey, rpId });
	return { session, expiresAt: fetchedAt + TAP_WINDOW_MS };
}

export async function tapAccessory(
	prepared: PreparedTap
): Promise<LinkTap & { expiresAt: number }> {
	return { ...prepared, response: await authenticatePasskeyForTransfer(prepared.session) };
}

export type FinishPhase = 'preparing' | 'approve' | 'confirming';

/** Links the tapped accessory to the connected wallet and waits for it to land. */
export async function finishLink(
	tap: LinkTap,
	ctx: SigningContext,
	onPhase: (p: FinishPhase) => void = () => {},
	onFeeSource?: OwnerAction['onFeeSource']
): Promise<string> {
	onPhase('preparing');
	const expectation = linkExpectation(tap, ctx.address);
	const sig = await submitAsOwner(ctx, {
		pda: tap.session.phygitalToken,
		computeUnits: LINK_COMPUTE_UNIT_LIMIT,
		precompileSignatures: 1,
		build: (recipient) => buildLinkInstructions(tap, recipient),
		verify: (bytes, built) =>
			validateLinkTransaction(
				bytes,
				{
					...expectation,
					feePayer: built.feePayer,
					...(built.refill ? { refill: built.refill } : {})
				},
				{ allowWalletAdditions: true }
			),
		onFeeSource: (source) => {
			onFeeSource?.(source);
			onPhase('approve');
		}
	});
	onPhase('confirming');
	await waitForConfirmation(sig);
	forgetWalletAccessories();
	refreshAccessory(tap.session.phygitalToken);
	return sig;
}

export async function releaseAccessory(
	ctx: SigningContext,
	pda: string,
	onFeeSource?: OwnerAction['onFeeSource']
): Promise<string> {
	const sig = await confirmAsOwner(ctx, {
		pda,
		refillFirst: true,
		onFeeSource,
		build: async (owner) => [
			getRemoveOwnerInstruction({
				owner,
				phygitalToken: address(pda),
				...(await getPolicyCloseAccounts(address(pda)))
			})
		]
	});
	forgetWalletAccessories();
	return sig;
}
