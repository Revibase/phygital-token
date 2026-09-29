import { describe, expect, it } from 'vitest';

import { linkCopy } from '$lib/client/accessory/link-copy';

describe('linkCopy', () => {
	it('Bearer: claiming a collectible, never framed as a wallet key', () => {
		const c = linkCopy('bearer');
		expect(c).toMatchObject({ action: 'Claim it', cancelled: 'Claim cancelled' });
		expect(c.confirm.title).toBe('Claim it with this wallet?');
		expect(c.done.title).toBe('It’s in your collection');
		expect(c.done.body(false, 'ENDm…VBNh')).toBe('It’s now in ENDm…VBNh’s collection.');
		expect(c.progress('ENDm…VBNh')).toBe('Claiming for ENDm…VBNh…');
		const all = [c.choose.body, c.confirm.body, c.done.body(true, ''), c.done.body(false, 'w')].join(' ');
		expect(all).not.toMatch(/prove/i);
	});

	it('Controlled: linking a key, with the lock and authentication spelled out before signing', () => {
		const c = linkCopy('controlled');
		expect(c).toMatchObject({ action: 'Link wallet', cancelled: 'Linking cancelled' });
		expect(c.confirm.body).toMatch(/prove they’re this wallet/);
		expect(c.confirm.body).toMatch(/locked to it until you unlink it/);
		expect(c.done.title).toBe('It’s yours');
		expect(c.done.body(true, '')).toBe('A tap now proves you’re this wallet. It stays locked to it until you unlink it.');
	});

	it('an unknown type gets the key wording, which carries the warning', () => {
		expect(linkCopy('unknown')).toBe(linkCopy('controlled'));
		expect(linkCopy(null)).toBe(linkCopy('controlled'));
		expect(linkCopy(undefined)).toBe(linkCopy('controlled'));
	});
});
