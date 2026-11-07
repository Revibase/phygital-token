import { NextResponse, type NextRequest } from 'next/server';

import type { CookieJar } from '#lib/server/session/cookies.ts';

/** Cookie jar bound to a route response, so session helpers can set Set-Cookie. */
export function responseCookies(request: NextRequest, response: NextResponse): CookieJar {
	return {
		get: (name) => request.cookies.get(name)?.value,
		set: (name, value, options) => {
			response.cookies.set(name, value, options);
		},
		delete: (name, options) => {
			response.cookies.set(name, '', {
				path: options.path,
				maxAge: 0,
				secure: options.secure,
				httpOnly: true,
				sameSite: 'lax'
			});
		}
	};
}

/**
 * Read-only cookie jar over a request's (or `next/headers`') cookie store, for
 * session readers; it never sets a cookie.
 */
export function readOnlyCookies(store: {
	get(name: string): { value: string } | undefined;
}): CookieJar {
	return {
		get: (name) => store.get(name)?.value,
		set: () => {
			throw new Error('This cookie jar is read-only.');
		},
		delete: () => {
			throw new Error('This cookie jar is read-only.');
		}
	};
}

export function json(body: unknown, status = 200): NextResponse {
	return NextResponse.json(body, { status });
}
