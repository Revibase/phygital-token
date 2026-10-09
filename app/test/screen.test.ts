import { describe, expect, it } from 'vitest';

import type { AccessoryView, TokenKind } from '$lib/shared/types';
import { accessoryRules } from '$lib/shared/accessory-view';
import { changedElsewhereNotice, tapScreen } from '$lib/client/accessory/screen';

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

describe('tapScreen: Bearer wallet linkage', () => {
	it('unclaimed: anyone can make it theirs', () => {
		expect(tapScreen(accessory('bearer', null), false)).toMatchObject({ title: 'No wallet linked', claim: true, walletLabel: null });
	});

	it('owner: in their collection, can move it, not pitched as a wallet key', () => {
		const s = tapScreen(accessory('bearer', W), true);
		expect(s).toMatchObject({ title: 'Linked to your wallet', walletLabel: 'Your wallet', claim: false, move: true });
		expect(s.body).not.toMatch(/prove/i);
	});

	it('lets available actions explain linking without repeating instructions', () => {
		for (const kind of ['bearer', 'controlled'] as const) {
			for (const linkedWallet of [null, W]) for (const owned of [false, true]) {
				expect(tapScreen(accessory(kind, linkedWallet), owned).body).toBe('');
			}
		}
		expect(tapScreen(accessory('permanent', W), false)).toMatchObject({ title: 'Permanently linked to a wallet', body: '' });
	});

	it('someone else: shows the owner and offers "Make it yours"', () => {
		expect(tapScreen(accessory('bearer', W), false)).toMatchObject({
			title: 'Linked to a wallet',
			walletLabel: 'Linked wallet',
			claim: true,
			move: false
		});
	});

	it('locked since issue: no claim until its owner unlinks it', () => {
		expect(tapScreen(accessory('bearer', W, true), false)).toMatchObject({ claim: false, body: '' });
		expect(tapScreen(accessory('bearer', W, true), true)).toMatchObject({ move: false, body: '' });
	});
});

describe('tapScreen: Controlled and Permanent wallet linkage', () => {
	it('Controlled unclaimed: anyone holding it can make it theirs', () => {
		expect(tapScreen(accessory('controlled', null), false)).toMatchObject({ title: 'No wallet linked', claim: true });
	});

	it('Controlled linked: never claimable, framed around authentication', () => {
		expect(tapScreen(accessory('controlled', W), true)).toMatchObject({ title: 'Linked to your wallet', walletLabel: 'Your wallet', claim: false, move: false });
		expect(tapScreen(accessory('controlled', W), false)).toMatchObject({ title: 'Linked to a wallet', walletLabel: 'Linked wallet', claim: false, move: false });
	});

	it('Permanent: bound for good, never claimable', () => {
		expect(tapScreen(accessory('permanent', W), true)).toMatchObject({ title: 'Permanently linked to your wallet', claim: false });
		expect(tapScreen(accessory('permanent', W), false)).toMatchObject({ title: 'Permanently linked to a wallet', claim: false });
	});

	it('Permanent without a wallet is unavailable, not claimable', () => {
		expect(tapScreen(accessory('permanent', null), false)).toMatchObject({ title: 'Unavailable', claim: false });
	});
});

describe('changedElsewhereNotice', () => {
	it('describes linkage changes by the applicable relinking rule', () => {
		expect(changedElsewhereNotice(accessory('bearer', W)).title).toBe('Linked to a different wallet');
		expect(changedElsewhereNotice(accessory('controlled', W)).title).toBe('Linked to a different wallet');
	});
});

describe('trading a card does not change its link rules', () => {
	it.each(['controlled', 'permanent'] as const)('%s explains wallet linkage for mint-backed cards', kind => {
		const a = { ...accessory(kind, W), mint: W };
		const screen = tapScreen(a, false);
		expect(screen.claim).toBe(false);
		expect(screen.walletLabel).toBe('Linked wallet');
		expect(screen.body).not.toMatch(/card|trad(e|ing)|collection/i);
		expect(screen.body).not.toMatch(/proves.*wallet/);
	});
});
