import { describe, expect, it } from 'vitest';

import { readBrowseLink } from '#lib/shared/browse-link.ts';

const pay = 'https://pay.test/send?cluster=devnet#AQEg';

describe('browse link', () => {
	it('opens an encoded page with its fragment, labelled by its own hostname', () => {
		expect(readBrowseLink([encodeURIComponent(pay)])).toEqual({
			ok: true,
			href: pay,
			hostname: 'pay.test'
		});
		expect(readBrowseLink([encodeURIComponent('https://www.shop.test/')])).toMatchObject({
			hostname: 'shop.test'
		});
	});

	it('opens a page whose path a proxy already decoded', () => {
		expect(readBrowseLink(['https:', 'pay.test', 'send?cluster=devnet#AQEg'])).toMatchObject({
			ok: true,
			href: pay
		});
	});

	it('refuses anything but an http(s) page', () => {
		expect(readBrowseLink(undefined)).toEqual({ ok: false, reason: 'missing' });
		expect(readBrowseLink([encodeURIComponent('javascript:alert(1)')])).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(readBrowseLink([encodeURIComponent('https://user:pw@pay.test/')])).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});
});
