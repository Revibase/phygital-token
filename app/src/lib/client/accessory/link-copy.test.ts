import { describe, expect, it } from 'vitest';

import { linkCopy } from './link-copy';

describe('linkCopy', () => {
	it('Bearer: claiming a collectible, never framed as sign-in', () => {
		const c = linkCopy('bearer');
		expect(c).toMatchObject({ action: 'Claim it', cancelled: 'Claim cancelled' });
		expect(c.confirm.title).toBe('Claim it with this wallet?');
		expect(c.done.title).toBe('It’s in your collection');
		expect(c.done.body(false, 'ENDm…VBNh')).toBe('It’s now in ENDm…VBNh’s collection.');
		expect(c.progress('ENDm…VBNh')).toBe('Claiming for ENDm…VBNh…');
		const all = [c.choose.body, c.confirm.body, c.done.body(true, ''), c.done.body(false, 'w')].join(' ');
		expect(all).not.toMatch(/sign in/i);
	});

	it('Controlled: linking a key, with the lock and sign-in spelled out before signing', () => {
		const c = linkCopy('controlled');
		expect(c).toMatchObject({ action: 'Link wallet', cancelled: 'Linking cancelled' });
		expect(c.confirm.body).toMatch(/sign in as this wallet/);
		expect(c.confirm.body).toMatch(/locked to it until you release it/);
		expect(c.done.title).toBe('It’s yours');
		expect(c.done.body(true, '')).toBe('It now signs in as your wallet, and stays locked to it until you release it.');
	});

	it('an unknown type gets the key wording, which carries the warning', () => {
		expect(linkCopy('unknown')).toBe(linkCopy('controlled'));
		expect(linkCopy(null)).toBe(linkCopy('controlled'));
		expect(linkCopy(undefined)).toBe(linkCopy('controlled'));
	});
});
