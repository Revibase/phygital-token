import { describe, expect, it } from 'vitest';

import type { AccessoryView, TokenKind } from '$lib/shared/types';
import { accessoryRules } from '$lib/server/accessory/view';
import { changedElsewhereNotice, tapScreen } from './screen';

const W = '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN';

function accessory(kind: TokenKind, linkedWallet: string | null, isLocked = linkedWallet !== null && kind !== 'bearer'): AccessoryView {
	const rules = accessoryRules(kind, linkedWallet, isLocked);
	return {
		pda: 'pda',
		identifier: 'id',
		tag: 'A1B2',
		publicKey: 'pk',
		kind,
		status: !linkedWallet ? (rules.canLink ? 'ready_to_link' : 'unavailable') : rules.canLink ? 'linked' : 'linked_locked',
		linkedWallet,
		isLocked,
		mint: null,
		lastSignCount: 0,
		...rules
	};
}

describe('tapScreen: Bearer is a tradable collectible', () => {
	it('unclaimed: anyone can make it theirs', () => {
		expect(tapScreen(accessory('bearer', null), false)).toMatchObject({ title: 'Unclaimed', claim: true, walletLabel: null });
	});

	it('owner: in their collection, can move it, not pitched as a sign-in key', () => {
		const s = tapScreen(accessory('bearer', W), true);
		expect(s).toMatchObject({ title: 'In your collection', walletLabel: 'Your wallet', claim: false, move: true });
		expect(s.body).not.toMatch(/sign in/i);
	});

	it('claiming is described as two steps: one tap, then one wallet approval', () => {
		const step = 'Make it yours in two steps: tap it, then approve in your wallet.';
		expect(tapScreen(accessory('bearer', null), false).body).toContain(step);
		expect(tapScreen(accessory('bearer', W), false).body).toContain(step);
		expect(tapScreen(accessory('controlled', null), false).body).toContain(step);
		for (const kind of ['bearer', 'controlled'] as const) {
			expect(tapScreen(accessory(kind, null), false).body).not.toMatch(/two taps/);
		}
	});

	it('someone else: shows the owner and offers "Make it yours"', () => {
		expect(tapScreen(accessory('bearer', W), false)).toMatchObject({
			title: 'In someone’s collection',
			walletLabel: 'Owned by',
			claim: true,
			move: false
		});
	});

	it('locked since issue: no claim until its owner releases it', () => {
		expect(tapScreen(accessory('bearer', W, true), false)).toMatchObject({ claim: false, body: 'It can change hands once its owner releases it.' });
		expect(tapScreen(accessory('bearer', W, true), true)).toMatchObject({ move: false, body: 'No one else can claim it until you release it.' });
	});
});

describe('tapScreen: Controlled and Permanent are personal keys', () => {
	it('Controlled unclaimed: anyone holding it can make it theirs', () => {
		expect(tapScreen(accessory('controlled', null), false)).toMatchObject({ title: 'Ready for its owner', claim: true });
	});

	it('Controlled linked: never claimable, framed around sign-in', () => {
		expect(tapScreen(accessory('controlled', W), true)).toMatchObject({ title: 'Yours', walletLabel: 'Your wallet', claim: false, move: false });
		expect(tapScreen(accessory('controlled', W), false)).toMatchObject({ title: 'Owned', walletLabel: 'Owned by', claim: false, move: false });
	});

	it('Permanent: bound for good, never claimable', () => {
		expect(tapScreen(accessory('permanent', W), true)).toMatchObject({ title: 'Yours for good', claim: false, footnote: 'This can’t be changed.' });
		expect(tapScreen(accessory('permanent', W), false)).toMatchObject({ title: 'Bound to its owner', claim: false });
	});

	it('Permanent without a wallet is unavailable, not claimable', () => {
		expect(tapScreen(accessory('permanent', null), false)).toMatchObject({ title: 'Unavailable', claim: false });
	});
});

describe('changedElsewhereNotice', () => {
	it('treats a new Bearer claim as a trade, and a Controlled change as a warning', () => {
		expect(changedElsewhereNotice(accessory('bearer', W)).title).toBe('Claimed by another wallet');
		expect(changedElsewhereNotice(accessory('controlled', W)).title).toBe('Linked to a different wallet');
	});
});
