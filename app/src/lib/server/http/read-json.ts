import { json } from '@sveltejs/kit';

/** Default cap for API request bodies; every current request is far smaller. */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

export type JsonObjectResult =
	{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

/**
 * Reads a JSON object body for an `/api/*` route, the same way everywhere:
 * oversized bodies get 413 before they are parsed, malformed JSON or a
 * non-object gets 400, and an empty body is `{}`. Field validation stays with
 * each route.
 */
export async function readJsonObject(
	request: Request,
	maxBytes = MAX_JSON_BODY_BYTES
): Promise<JsonObjectResult> {
	const tooLarge = {
		ok: false as const,
		response: json({ error: 'Request too large', code: 'too_large' }, { status: 413 })
	};
	const bad = {
		ok: false as const,
		response: json({ error: 'Invalid JSON body', code: 'bad_request' }, { status: 400 })
	};
	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return tooLarge;
	let text: string;
	try {
		text = await request.text();
	} catch {
		return bad;
	}
	if (new TextEncoder().encode(text).length > maxBytes) return tooLarge;
	if (!text) return { ok: true, body: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return bad;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad;
	return { ok: true, body: parsed as Record<string, unknown> };
}
