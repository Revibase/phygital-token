import {
	getSolanaErrorFromTransactionError,
	type GetSignatureStatusesApi,
	type Rpc,
	type Signature
} from '@solana/kit';

/**
 * Poll until `signature` is confirmed. A failed transaction throws Kit's Solana
 * error (it carries the program's code, which `describeError` turns into
 * specific copy). `expired`, checked alongside each status read, returns the
 * error to give up with, or null to keep waiting.
 */
export async function pollConfirmation(
	rpc: Rpc<GetSignatureStatusesApi>,
	signature: Signature,
	options: { pollMs: number; expired: () => Promise<Error | null> }
): Promise<void> {
	for (;;) {
		const [{ value }, expired] = await Promise.all([
			rpc.getSignatureStatuses([signature]).send(),
			options.expired()
		]);
		const status = value[0];
		if (status?.err) throw getSolanaErrorFromTransactionError(status.err);
		if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
			return;
		}
		if (expired) throw expired;
		await new Promise((resolve) => setTimeout(resolve, options.pollMs));
	}
}
