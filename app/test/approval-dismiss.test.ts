import { describe, expect, it } from 'vitest';

import { actionFailure, describeError, isDismissedFlow } from '#lib/client/link/messages.ts';

function wrapped(cause: Error) {
	return new Error('Failed to connect to wallet', { cause });
}

describe('closing a Privy approval', () => {
	it('stays quiet when Privy wraps the closed connecting screen', () => {
		const err = wrapped(new Error('User exited before wallet could be connected'));
		expect(isDismissedFlow(err)).toBe(true);
		expect(actionFailure(err)).toBeNull();
	});

	it('stays quiet when the transaction approval is closed', () => {
		const err = wrapped(new Error('User exited the modal before submitting the transaction'));
		expect(actionFailure(err)).toBeNull();
	});

	it('stays quiet when the signer rejects the request', () => {
		const err = wrapped(Object.assign(new Error('The user rejected the request.'), { code: 4001 }));
		expect(actionFailure(err)).toBeNull();
		expect(describeError(err).title).toBe('Cancelled');
	});

	it('still reports a real connection failure', () => {
		const err = wrapped(new Error('Network request failed'));
		expect(isDismissedFlow(err)).toBe(false);
		expect(actionFailure(err)).toMatchObject({
			title: 'Something went wrong',
			detail: 'Failed to connect to wallet'
		});
	});
});
