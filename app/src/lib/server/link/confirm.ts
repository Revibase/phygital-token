import { signature as toSignature, type Rpc, type SolanaRpcApi } from '@solana/kit';

import type { LinkErrorCode } from '$lib/shared/types';
import { fetchAccessory } from '../accessory/resolve';
import { fromTransactionError } from '$lib/shared/link-errors';

export type ConfirmOutcome =
	| { status: 'linked' }
	| { status: 'pending' }
	| { status: 'failed'; code: LinkErrorCode };

/**
 * Settle a submitted link. Success is defined by chain state, not by the
 * signature alone: the account must now name the intended recipient.
 */
export async function checkSubmittedLink(
	rpc: Rpc<SolanaRpcApi>,
	input: { txSignature: string; pda: string; recipient: string; tapWindowOver: boolean }
): Promise<ConfirmOutcome> {
	const { value } = await rpc
		.getSignatureStatuses([toSignature(input.txSignature)], { searchTransactionHistory: false })
		.send();
	const status = value[0];

	if (status?.err) return { status: 'failed', code: fromTransactionError(status.err) };

	if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
		const accessory = await fetchAccessory(rpc, input.pda);
		if (accessory && String(accessory.account.linkedWallet) === input.recipient) return { status: 'linked' };
		return { status: 'failed', code: 'unknown' };
	}

	if (!status && input.tapWindowOver) {
		// Never landed and the tap can no longer be valid: it will not land now.
		const accessory = await fetchAccessory(rpc, input.pda);
		if (accessory && String(accessory.account.linkedWallet) === input.recipient) return { status: 'linked' };
		return { status: 'failed', code: 'too_slow' };
	}
	return { status: 'pending' };
}
