import { json, type Handle } from '@sveltejs/kit';

/**
 * - JSON APIs require a same-origin `Origin` header (SameSite=Lax cookies plus
 *   this check closes CSRF; SvelteKit's own check only covers form posts).
 * - Security headers everywhere; CSP itself is configured in vite.config.ts
 *   (`kit.csp`) so SvelteKit can hash/nonce its inline bootstrap script.
 * - An embedded-app page (`locals.frameSrc`) gets `frame-src` for that one origin. It's appended to
 *   SvelteKit's own policy: a second CSP header could only narrow it, never allow a frame.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	if (url.pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
		const origin = request.headers.get('origin');
		if (origin !== url.origin) {
			return json({ error: 'Cross-site request blocked.', code: 'forbidden' }, { status: 403 });
		}
	}

	const response = await resolve(event);
	const headers = response.headers;
	const csp = headers.get('content-security-policy');
	if (event.locals.frameSrc && csp) headers.set('content-security-policy', `${csp}; frame-src ${event.locals.frameSrc}`);
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	headers.set('Permissions-Policy', 'publickey-credentials-get=(self), camera=(), microphone=(), geolocation=()');
	if (url.pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
	return response;
};
