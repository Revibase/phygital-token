import { json } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';

import { passkeyEnv } from '#lib/server/passkey-env.ts';

/**
 * - JSON APIs require a same-origin `Origin` header (SameSite=Lax cookies plus
 *   this check closes CSRF; SvelteKit's own check only covers form posts).
 * - Security headers everywhere; CSP itself is configured in vite.config.ts
 *   (`kit.csp`) so SvelteKit can hash/nonce its inline bootstrap script.
 *   `frame-src` allows embed shortcuts. This app still cannot be framed.
 * - Passkeys: this page's own (taps), plus the Revibase Passkey signer frame's.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	if (url.pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
		if (request.headers.get('origin') !== url.origin) {
			return json({ error: 'Cross-site request blocked.', code: 'forbidden' }, { status: 403 });
		}
	}

	const response = await resolve(event);
	const headers = response.headers;
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	const signer = passkeyEnv(env.SECURE_SIGNER_ORIGIN, env.FEE_PAYER_KEY)?.signerOrigin;
	headers.set(
		'Permissions-Policy',
		`publickey-credentials-get=(self${signer ? ` "${signer}"` : ''}), clipboard-write=(self), camera=(), microphone=(), geolocation=()`
	);
	if (url.pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
	return response;
};
