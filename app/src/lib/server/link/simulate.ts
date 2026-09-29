import { address, createNoopSigner, getBase64Decoder, type Rpc, type SolanaRpcApi } from '@solana/kit';

import { buildLinkTransaction, expectationFromPayload, validateLinkTransaction } from '$lib/shared/link-transaction';
import type { LinkErrorCode, TransferPayload } from '$lib/shared/types';
import { fromTransactionError } from './errors';

export type SimulationResult = { ok: true } | { ok: false; code: LinkErrorCode; logs?: readonly string[] };

/**
 * Run the exact instructions the wallet will sign through the real program
 * (signature verification off, blockhash replaced). The program — not this
 * app — decides whether the tap, lock state and sign count are acceptable.
 * Also catches a recipient with no SOL for fees.
 */
export async function simulateLink(
	rpc: Rpc<SolanaRpcApi>,
	payload: TransferPayload,
	recipient: string
): Promise<SimulationResult> {
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const { wireBytes } = await buildLinkTransaction({
		payload,
		rpc,
		recipient: createNoopSigner(address(recipient)),
		blockhash
	});
	validateLinkTransaction(wireBytes, expectationFromPayload(payload, recipient));

	const { value } = await rpc
		.simulateTransaction(getBase64Decoder().decode(wireBytes) as Parameters<typeof rpc.simulateTransaction>[0], {
			encoding: 'base64',
			sigVerify: false,
			replaceRecentBlockhash: true,
			commitment: 'confirmed'
		})
		.send();

	if (value.err) return { ok: false, code: fromTransactionError(value.err), logs: value.logs ?? undefined };
	return { ok: true };
}
