import { signature as toSignature } from '@solana/kit';

import { pollConfirmation } from '#lib/shared/confirm.ts';
import { browserRpc } from './rpc';

export function waitForConfirmation(sig: string, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	return pollConfirmation(browserRpc(), toSignature(sig), {
		pollMs: 1500,
		expired: async () =>
			Date.now() < deadline
				? null
				: new Error('Still waiting for the network. Check again in a moment.')
	});
}
