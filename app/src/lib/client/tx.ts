import { getSolanaErrorFromTransactionError, signature as toSignature } from '@solana/kit';

import { browserRpc } from './rpc';

export async function waitForConfirmation(sig: string, timeoutMs = 90_000) {
	const rpc = browserRpc();
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { value } = await rpc.getSignatureStatuses([toSignature(sig)]).send();
		const status = value[0];
		// Kit's error carries the program's code, which `describeError` turns into specific copy.
		if (status?.err) throw getSolanaErrorFromTransactionError(status.err);
		if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
			return;
		}
		await new Promise((r) => setTimeout(r, 1500));
	}
	throw new Error('Still waiting for the network. Check again in a moment.');
}
