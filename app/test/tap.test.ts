import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';

import { bytesToBase64Url, base64UrlToBytes } from '#lib/shared/encoding.ts';
import { createTestD1 } from './support/d1-sqlite';
import { chip } from './support/fixtures';
import { consumeTapCounter } from '#lib/server/tap/counter-store.ts';
import { verifyDynamicUrlWithoutCounterCheck } from '#lib/server/tap/verify-dynamic-url.ts';

describe('verifyDynamicUrlWithoutCounterCheck', () => {
	it('verifies a genuine chip signature over counter||nonce', () => {
		const c = chip();
		const result = verifyDynamicUrlWithoutCounterCheck(c.tap(7));
		expect(result).toEqual({ isVerified: true, identifier: bytesToBase64Url(c.pk), counter: 7 });
	});

	it('accepts a high-S encoding of a valid signature', () => {
		const c = chip();
		const params = c.tap(9);
		const sig = p256.Signature.fromBytes(base64UrlToBytes(params.get('s')!), 'compact');
		const highS = new p256.Signature(sig.r, p256.Point.CURVE().n - sig.s).toBytes('compact');
		params.set('s', bytesToBase64Url(highS));
		expect(verifyDynamicUrlWithoutCounterCheck(params).isVerified).toBe(true);
	});

	it('rejects a tampered signature, counter, or nonce', () => {
		const c = chip();
		const params = c.tap(7);
		const sig = base64UrlToBytes(params.get('s')!);
		sig[10] ^= 0x01;
		expect(
			verifyDynamicUrlWithoutCounterCheck(
				new URLSearchParams({ ...Object.fromEntries(params), s: bytesToBase64Url(sig) })
			).isVerified
		).toBe(false);
		expect(
			verifyDynamicUrlWithoutCounterCheck(
				new URLSearchParams({ ...Object.fromEntries(params), c: '8' })
			).isVerified
		).toBe(false);
		expect(
			verifyDynamicUrlWithoutCounterCheck(
				new URLSearchParams({
					...Object.fromEntries(params),
					n: bytesToBase64Url(new Uint8Array(8))
				})
			).isVerified
		).toBe(false);
	});

	it('canonicalizes padded identifiers so counters are keyed once per chip', () => {
		const c = chip();
		const params = c.tap(3);
		params.set('pk', params.get('pk')! + '=');
		// 33 bytes → 44 base64 chars incl. one '=' when padded
		expect(verifyDynamicUrlWithoutCounterCheck(params).identifier).toBe(bytesToBase64Url(c.pk));
	});

	it.each([
		[{ pk: bytesToBase64Url(new Uint8Array(10)) }, /33-byte/],
		[{ n: bytesToBase64Url(new Uint8Array(4)) }, /8 bytes/],
		[{ s: bytesToBase64Url(new Uint8Array(63)) }, /64-byte/],
		[{ c: '-1' }, /uint32/],
		[{ c: '4294967296' }, /uint32/],
		[{ c: '1e3' }, /uint32/],
		[{ pk: 'not base64!' }, /base64url/]
	])('throws on malformed input %o', (override, message) => {
		expect(() => verifyDynamicUrlWithoutCounterCheck(chip().tap(1, override))).toThrow(message);
	});

	it('throws on missing params', () => {
		expect(() => verifyDynamicUrlWithoutCounterCheck(new URLSearchParams({ pk: 'x' }))).toThrow(
			/Missing/
		);
	});
});

describe('consumeTapCounter (shared high-water mark)', () => {
	it('accepts strictly increasing counters and rejects replays and out-of-order taps', async () => {
		const db = createTestD1();
		expect(await consumeTapCounter(db, 'chip', 5)).toBe('new');
		expect(await consumeTapCounter(db, 'chip', 5)).toBe('replay');
		expect(await consumeTapCounter(db, 'chip', 4)).toBe('replay');
		expect(await consumeTapCounter(db, 'chip', 7)).toBe('new');
		// Tap 6 arriving after 7 is stale: the newest tap wins.
		expect(await consumeTapCounter(db, 'chip', 6)).toBe('replay');
		expect(await consumeTapCounter(db, 'other-chip', 1)).toBe('new');
	});

	it('lets exactly one of many concurrent submissions of the same URL through', async () => {
		const db = createTestD1();
		const verdicts = await Promise.all(
			Array.from({ length: 20 }, () => consumeTapCounter(db, 'chip', 42))
		);
		expect(verdicts.filter((v) => v === 'new')).toHaveLength(1);
	});
});
