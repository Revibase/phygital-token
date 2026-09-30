import { afterEach, describe, expect, it } from 'vitest';

import { FRAME_ALLOW, FRAME_SANDBOX, allowsFraming, isFramable, withFramingCheck } from '$lib/server/accessory/embed';
import type { Shortcut } from '$lib/shared/shortcuts';

const US = 'https://portal.revibase.com';
const h = (init: Record<string, string>) => new Headers(init);
const csp = (policy: string) => h({ 'content-security-policy': policy });

describe('allowsFraming', () => {
	it('allows a site with no framing headers', () => {
		expect(allowsFraming(h({}), US)).toBe(true);
	});

	it('refuses X-Frame-Options of any kind when there is no frame-ancestors', () => {
		for (const v of ['DENY', 'SAMEORIGIN', 'ALLOW-FROM https://portal.revibase.com']) {
			expect(allowsFraming(h({ 'x-frame-options': v }), US)).toBe(false);
		}
	});

	it('reads frame-ancestors source lists the way browsers do', () => {
		const allowed = [
			'*',
			'https:',
			"'self' https://portal.revibase.com",
			'portal.revibase.com',
			'https://*.revibase.com',
			'https://portal.revibase.com:443',
			'https://portal.revibase.com/some/path',
			'http://portal.revibase.com' // an http source matches the https upgrade
		];
		for (const list of allowed) expect(allowsFraming(csp(`default-src 'self'; frame-ancestors ${list}`), US), list).toBe(true);

		const refused = ["'none'", "'self'", 'https://revibase.com', 'https://*.evil.test', 'https://portal.revibase.com:8443', 'https://portal.revibase.com.evil.test', 'ws://portal.revibase.com'];
		for (const list of refused) expect(allowsFraming(csp(`frame-ancestors ${list}`), US), list).toBe(false);
	});

	it('lets frame-ancestors override X-Frame-Options, and requires every policy to allow', () => {
		expect(allowsFraming(h({ 'x-frame-options': 'DENY', 'content-security-policy': `frame-ancestors ${US}` }), US)).toBe(true);
		expect(allowsFraming(csp(`frame-ancestors ${US}, frame-ancestors 'none'`), US)).toBe(false);
		expect(allowsFraming(csp(`script-src 'self', frame-ancestors ${US}`), US)).toBe(true);
	});
});

describe('isFramable', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});
	const serve = (headers: Record<string, string>, status = 200, finalUrl?: string, seen: string[] = []) => {
		globalThis.fetch = (async (input: unknown) => {
			seen.push(String(input));
			const res = new Response('<html></html>', { status, headers });
			if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
			return res;
		}) as typeof fetch;
		return seen;
	};

	it('checks the live page', async () => {
		serve({ 'content-security-policy': `frame-ancestors ${US}` });
		expect(await isFramable('https://game.xyz/play', US)).toBe(true);
		serve({ 'x-frame-options': 'DENY' });
		expect(await isFramable('https://game.xyz/play', US)).toBe(false);
	});

	it('refuses errors, cross-origin redirects, non-https and network failures', async () => {
		serve({}, 404);
		expect(await isFramable('https://game.xyz/play', US)).toBe(false);
		serve({}, 200, 'https://login.other.test/');
		expect(await isFramable('https://game.xyz/play', US)).toBe(false);
		expect(await isFramable('http://game.xyz/play', US)).toBe(false);
		globalThis.fetch = (async () => {
			throw new Error('timeout');
		}) as typeof fetch;
		expect(await isFramable('https://game.xyz/play', US)).toBe(false);
	});

	it('keeps immerse only where the site allows it, checking only immerse shortcuts', async () => {
		const seen = serve({ 'x-frame-options': 'DENY' });
		const s = (label: string, immerse: boolean): Shortcut => ({ label, href: `https://game.xyz/${label}`, icon: 'gaming', image: null, immerse, proof: false, external: false, platform: 'all' });
		const out = await withFramingCheck([s('play', true), s('stake', false)], US);
		expect(out.map((x) => x.immerse)).toEqual([false, false]);
		expect(seen).toEqual(['https://game.xyz/play']);
	});
});

describe('frame policy', () => {
	it('never delegates passkeys or device access, and never lets the app navigate our page', () => {
		expect(FRAME_ALLOW).not.toMatch(/publickey|camera|microphone|geolocation/);
		expect(FRAME_SANDBOX).not.toMatch(/allow-top-navigation/);
		expect(FRAME_SANDBOX.split(' ')).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']));
	});
});
