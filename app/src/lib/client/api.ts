import type { LinkErrorCode } from '$lib/shared/types';

export class ApiClientError extends Error {
	constructor(
		readonly status: number,
		readonly code: LinkErrorCode | string,
		message: string
	) {
		super(message);
		this.name = 'ApiClientError';
	}
}

async function parse<T>(res: Response): Promise<T> {
	const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
	if (!res.ok) throw new ApiClientError(res.status, body.code ?? 'network', body.error ?? 'Something went wrong.');
	return body as T;
}

export async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		});
	} catch {
		throw new ApiClientError(0, 'network', 'You appear to be offline. Check your connection and try again.');
	}
	return parse<T>(res);
}

export async function getJson<T>(path: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
	} catch {
		throw new ApiClientError(0, 'network', 'You appear to be offline. Check your connection and try again.');
	}
	return parse<T>(res);
}
