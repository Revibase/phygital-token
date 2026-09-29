import { json, type RequestEvent } from '@sveltejs/kit';

import { getEnv, type ServerEnv } from '../env';
import { errorResponse, readCaller, readJson, type Caller } from './service';

/** Uniform JSON handler: env + caller + body, errors mapped to `{ error, code }`. */
export function linkRoute<T>(
	fn: (ctx: { env: ServerEnv; caller: Caller; body: Record<string, unknown>; event: RequestEvent }) => Promise<T>
) {
	return async (event: RequestEvent) => {
		try {
			const env = getEnv(event.platform);
			const caller = await readCaller(event.cookies, env);
			const body = event.request.method === 'GET' ? {} : await readJson(event.request);
			return json(await fn({ env, caller, body, event }));
		} catch (err) {
			return errorResponse(err);
		}
	};
}
