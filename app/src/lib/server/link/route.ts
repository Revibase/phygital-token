import { json, type RequestEvent } from '@sveltejs/kit';

import { getEnv, type ServerEnv } from '../env';
import { readJsonObject } from '../http/read-json';
import { errorResponse, readCaller, type Caller } from './service';

/** Uniform JSON handler: env + caller + body, errors mapped to `{ error, code }`. */
export function linkRoute<T>(
	fn: (ctx: {
		env: ServerEnv;
		caller: Caller;
		body: Record<string, unknown>;
		event: RequestEvent;
	}) => Promise<T>
) {
	return async (event: RequestEvent) => {
		try {
			const env = getEnv(event.platform);
			const caller = await readCaller(event.cookies, env);
			let body: Record<string, unknown> = {};
			if (event.request.method !== 'GET') {
				const read = await readJsonObject(event.request);
				if (!read.ok) return read.response;
				body = read.body;
			}
			return json(await fn({ env, caller, body, event }));
		} catch (err) {
			return errorResponse(err);
		}
	};
}
