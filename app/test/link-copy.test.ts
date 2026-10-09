import { describe, expect, it } from 'vitest';
import { linkCopy } from '$lib/client/accessory/link-copy';

describe('neutral wallet linking copy', () => {
	it.each(['bearer', 'controlled', 'unknown'] as const)('%s describes linkage without assuming an accessory use', kind => {
		const c = linkCopy(kind);
		expect(c).toMatchObject({pageTitle: 'Link a wallet', action: 'Link wallet', cancelled: 'Linking cancelled'});
		expect(c.confirm.title).toBe('Link this wallet?');
		expect(c.done.title).toBe('Wallet linked');
		expect(c.progress('wallet')).toBe('Linking to wallet…');
		const text = [c.choose.body, c.confirm.body, c.done.body(true, ''), c.done.body(false, 'wallet')].join(' ');
		expect(text).not.toMatch(/trad(e|ing)|card|collection|claim|prove.*wallet/i);
	});
	it('explains the distinct relinking rules', () => {
		expect(linkCopy('bearer').confirm.body).toContain('relink it while unlocked');
		expect(linkCopy('controlled').confirm.body).toContain('Only the linked wallet can unlink it');
	});
	it('unknown types retain the stricter linkage warning', () => {
		expect(linkCopy('unknown')).toBe(linkCopy('controlled'));
		expect(linkCopy(null)).toBe(linkCopy('controlled'));
		expect(linkCopy(undefined)).toBe(linkCopy('controlled'));
	});
});
