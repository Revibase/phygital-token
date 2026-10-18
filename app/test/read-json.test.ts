import { describe, expect, it } from 'vitest';
import { readJsonObject } from '#lib/server/http/read-json.ts';

const post = (body: string, headers: Record<string, string> = {}) =>
	new Request('https://example.test/api/x', { method: 'POST', body, headers });

describe('readJsonObject', () => {
	it('returns the parsed object', async () => {
		const read = await readJsonObject(post('{"a":1}'));
		expect(read).toEqual({ ok: true, body: { a: 1 } });
	});

	it('treats an empty body as {}', async () => {
		expect(await readJsonObject(post(''))).toEqual({ ok: true, body: {} });
	});

	it.each([
		['malformed JSON', '{"a":'],
		['an array', '[1,2]'],
		['a string', '"x"'],
		['null', 'null']
	])('rejects %s with 400', async (_label, body) => {
		const read = await readJsonObject(post(body));
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.response.status).toBe(400);
	});

	it('rejects an oversized body with 413 by content-length', async () => {
		const read = await readJsonObject(post('{}', { 'content-length': '999999' }), 1024);
		expect(!read.ok && read.response.status).toBe(413);
	});

	it('rejects an oversized body with 413 by actual size', async () => {
		const read = await readJsonObject(post(JSON.stringify({ a: 'x'.repeat(2000) })), 1024);
		expect(!read.ok && read.response.status).toBe(413);
	});
});
