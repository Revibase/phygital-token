import { describe, expect, it } from 'vitest';

import type { AccessoryView, TokenKind } from '#lib/shared/types.ts';
import { accessoryRules } from '#lib/shared/accessory-view.ts';
import { tapScreen, managementActions } from '#lib/client/accessory/screen.ts';

const W = '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN';

function accessory(
	kind: TokenKind,
	owner: string | null,
	isLocked = owner !== null && kind !== 'bearer'
): AccessoryView {
	const rules = accessoryRules(kind, owner, isLocked);
	return {
		pda: 'pda',
		tag: 'A1B2',
		publicKey: 'pk',
		kind,
		status: !owner
			? rules.canLink
				? 'ready_to_link'
				: 'unavailable'
			: rules.canLink
				? 'linked'
				: 'linked_locked',
		owner,
		isLocked,
		mint: null,
		...rules
	};
}

describe('tapScreen: Bearer wallet linkage', () => {
	it('unclaimed: anyone can make it theirs', () => {
		expect(tapScreen(accessory('bearer', null), false)).toMatchObject({
			title: 'Ready to claim',
			claim: true
		});
	});

	it('owner: in their collection, can move it, not pitched as a wallet key', () => {
		const s = tapScreen(accessory('bearer', W), true);
		expect(s).toMatchObject({ title: 'Your accessory', claim: false });
		expect(s.body).not.toMatch(/prove/i);
	});

	it('lets available actions explain linking without repeating instructions', () => {
		for (const kind of ['bearer', 'controlled'] as const) {
			for (const owner of [null, W])
				for (const owned of [false, true]) {
					expect(tapScreen(accessory(kind, owner), owned).body).toBe('');
				}
		}
		expect(tapScreen(accessory('permanent', W), false)).toMatchObject({
			title: 'Permanently owned',
			body: ''
		});
	});

	it('someone else: shows the owner and offers "Make it yours"', () => {
		expect(tapScreen(accessory('bearer', W), false)).toMatchObject({
			title: 'Claimed',
			claim: true
		});
	});

	it('locked since issue: no claim until its owner unlinks it', () => {
		expect(tapScreen(accessory('bearer', W, true), false)).toMatchObject({
			claim: false,
			body: ''
		});
		expect(tapScreen(accessory('bearer', W, true), true)).toMatchObject({ claim: false, body: '' });
	});
});

describe('tapScreen: Controlled and Permanent wallet linkage', () => {
	it('Controlled unclaimed: anyone holding it can make it theirs', () => {
		expect(tapScreen(accessory('controlled', null), false)).toMatchObject({
			title: 'Ready to claim',
			claim: true
		});
	});

	it('Controlled linked: never claimable, framed around authentication', () => {
		expect(tapScreen(accessory('controlled', W), true)).toMatchObject({
			title: 'Your accessory',
			claim: false
		});
		expect(tapScreen(accessory('controlled', W), false)).toMatchObject({
			title: 'Claimed',
			claim: false
		});
	});

	it('Permanent: bound for good, never claimable', () => {
		expect(tapScreen(accessory('permanent', W), true)).toMatchObject({
			title: 'Your accessory',
			claim: false
		});
		expect(tapScreen(accessory('permanent', W), false)).toMatchObject({
			title: 'Permanently owned',
			claim: false
		});
	});

	it('Permanent without a wallet is unavailable, not claimable', () => {
		expect(tapScreen(accessory('permanent', null), false)).toMatchObject({
			title: 'Unavailable',
			claim: false
		});
	});
});

describe('trading a card does not change its link rules', () => {
	it.each(['controlled', 'permanent'] as const)(
		'%s explains wallet linkage for mint-backed cards',
		(kind) => {
			const a = { ...accessory(kind, W), mint: W };
			const screen = tapScreen(a, false);
			expect(screen.claim).toBe(false);
			expect(screen.body).not.toMatch(/card|trad(e|ing)|collection/i);
			expect(screen.body).not.toMatch(/proves.*wallet/);
		}
	);
});

describe('accessory management actions', () => {
	it.each(['bearer', 'controlled'] as const)(
		'%s unclaimed offers no ownership controls',
		(kind) => {
			expect(managementActions(accessory(kind, null), false)).toEqual({
				release: false,
				changeOwner: false,
				hasActions: false
			});
		}
	);
	it('bearer owner can change or release; a locked bearer owner can only release', () => {
		expect(managementActions(accessory('bearer', W), true)).toMatchObject({
			release: true,
			changeOwner: true
		});
		expect(managementActions(accessory('bearer', W, true), true)).toMatchObject({
			release: true,
			changeOwner: false
		});
	});
	it.each(['bearer', 'controlled'] as const)(
		'%s visitors can start a release (it needs the owner wallet) but not change owner',
		(kind) => {
			expect(managementActions(accessory(kind, W), false)).toMatchObject({
				release: true,
				changeOwner: false
			});
		}
	);
	it('controlled owner releases before changing owner', () => {
		expect(managementActions(accessory('controlled', W), true)).toMatchObject({
			release: true,
			changeOwner: false
		});
	});
	it.each([false, true])('permanent owner connection=%s offers no ownership changes', (owned) => {
		expect(managementActions(accessory('permanent', W), owned)).toEqual({
			release: false,
			changeOwner: false,
			hasActions: false
		});
	});
	it('does not offer actions for unavailable or unknown records', () => {
		expect(
			managementActions({ ...accessory('bearer', W), status: 'unavailable' }, true).hasActions
		).toBe(false);
		expect(
			managementActions({ ...accessory('bearer', W), kind: 'unknown' }, false).hasActions
		).toBe(false);
	});
});
