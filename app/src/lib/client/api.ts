import type { LinkErrorCode } from '$lib/shared/types';

export class ApiClientError extends Error {
	constructor(
		readonly status: number,
		readonly code: LinkErrorCode | (string & {}),
		message: string
	) {
		super(message);
		this.name = 'ApiClientError';
	}
}

async function parse<T>(res: Response): Promise<T> {
	const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
	if (!res.ok)
		throw new ApiClientError(
			res.status,
			body.code ?? 'network',
			body.error ?? 'Something went wrong.'
		);
	return body as T;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, { ...init, credentials: 'same-origin' });
	} catch {
		throw new ApiClientError(
			0,
			'network',
			'You appear to be offline. Check your connection and try again.'
		);
	}
	return parse<T>(res);
}

export async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
	return requestJson<T>(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

export function getJson<T>(path: string): Promise<T> {
	return requestJson<T>(path, { cache: 'no-store' });
}
