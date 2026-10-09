import { describe, expect, it } from 'vitest';
import { address } from '@solana/kit';

import { fakeAccessory } from './support/fixtures';
import { accessoryRules, toAccessoryView } from '$lib/shared/accessory-view';

const W = '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN';
const UNSET = null;

describe('accessoryRules', () => {
	it('Bearer: moves to a new wallet with a tap while unlocked; owner can release', () => {
		expect(accessoryRules('bearer', UNSET, false)).toEqual({ canLink: true, canRelease: false });
		expect(accessoryRules('bearer', W, false)).toEqual({ canLink: true, canRelease: true });
	});

	it('Controlled: links only when unlinked; must be released before linking a different wallet', () => {
		expect(accessoryRules('controlled', UNSET, false)).toEqual({ canLink: true, canRelease: false });
		expect(accessoryRules('controlled', W, true)).toEqual({ canLink: false, canRelease: true });
		// Even if the lock flag were somehow clear, a linked Controlled token is not re-linkable.
		expect(accessoryRules('controlled', W, false)).toEqual({ canLink: false, canRelease: true });
	});

	it('Permanent: fixed forever — never links, never releases', () => {
		expect(accessoryRules('permanent', W, true)).toEqual({ canLink: false, canRelease: false });
		expect(accessoryRules('permanent', W, false)).toEqual({ canLink: false, canRelease: false });
		expect(accessoryRules('permanent', UNSET, false)).toEqual({ canLink: false, canRelease: false });
	});
});

describe('toAccessoryView', () => {
	const acc = fakeAccessory();
	const view = (o: Parameters<typeof acc.account>[0]) => toAccessoryView('pda', acc.account(o));

	it('Controlled + linked is shown locked, with release only', () => {
		expect(view({ tokenType: 2, owner: address(W), isLocked: 1 })).toMatchObject({
			kind: 'controlled',
			status: 'linked_locked',
			canLink: false,
			canRelease: true
		});
	});

	it('Permanent is shown linked-and-fixed with no actions; an unlinked Permanent is unavailable', () => {
		expect(view({ tokenType: 0, owner: address(W), isLocked: 1 })).toMatchObject({
			status: 'linked_locked',
			canLink: false,
			canRelease: false
		});
		expect(view({ tokenType: 0 })).toMatchObject({ status: 'unavailable', canLink: false, canRelease: false });
	});

	it('Bearer + linked stays re-linkable', () => {
		expect(view({ tokenType: 1, owner: address(W) })).toMatchObject({ status: 'linked', canLink: true, canRelease: true });
	});
});
