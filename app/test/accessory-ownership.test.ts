import { describe, expect, it } from 'vitest';
import { isConnectedAccessoryOwner } from '$lib/client/accessory/ownership';

describe('connected accessory owner', () => {
	it('allows owner actions only for the connected owner', () => {
		expect(isConnectedAccessoryOwner('owner-wallet', 'owner-wallet')).toBe(true);
		expect(isConnectedAccessoryOwner('owner-wallet', 'other-wallet')).toBe(false);
		expect(isConnectedAccessoryOwner('owner-wallet', null)).toBe(false);
		expect(isConnectedAccessoryOwner(null, 'owner-wallet')).toBe(false);
	});
});
