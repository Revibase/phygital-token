import { json, type Handle } from '@sveltejs/kit';

/**
 * - JSON APIs require a same-origin `Origin` header (SameSite=Lax cookies plus
 *   this check closes CSRF; SvelteKit's own check only covers form posts).
 *   The exceptions: `/api/signer/*`, called by the passkey-wallet iframe from
 *   its own origin with CORS and no cookies; and `/api/sponsor/*`, the public
 *   fee service any site's accessory wallet calls (no cookies, so open CORS).
 * - Security headers everywhere; CSP itself is configured in vite.config.ts
 *   (`kit.csp`) so SvelteKit can hash/nonce its inline bootstrap script.
 * - `frame-src` (one directive: a second one would be ignored) allows the
 *   passkey-wallet iframe on every page. Project shortcuts open in browser tabs.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const signerOrigin = event.platform?.env?.SECURE_SIGNER_ORIGIN ?? null;
	const signerApi = url.pathname.startsWith('/api/signer/');
	const origin = request.headers.get('origin');
	const fromSigner = signerApi && !!signerOrigin && origin === signerOrigin;
	const sponsorApi = url.pathname === '/api/sponsor' || url.pathname.startsWith('/api/sponsor/');
	const cors: Record<string, string> | null = sponsorApi
		? {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST',
				'Access-Control-Allow-Headers': 'content-type'
			}
		: fromSigner
			? {
					'Access-Control-Allow-Origin': signerOrigin,
					'Access-Control-Allow-Methods': 'POST, PUT',
					'Access-Control-Allow-Headers': 'content-type',
					Vary: 'Origin'
				}
			: null;

	if ((signerApi || sponsorApi) && request.method === 'OPTIONS') {
		return new Response(null, {
			status: cors ? 204 : 403,
			headers: { ...(cors ?? {}), 'Access-Control-Max-Age': '600' }
		});
	}
	if (url.pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
		if (origin !== url.origin && !fromSigner && !sponsorApi) {
			return json({ error: 'Cross-site request blocked.', code: 'forbidden' }, { status: 403 });
		}
	}

	const response = await resolve(event);
	const headers = response.headers;
	const csp = headers.get('content-security-policy');
	if (csp && signerOrigin)
		headers.set('content-security-policy', `${csp}; frame-src ${signerOrigin}`);
	if (cors) for (const [k, v] of Object.entries(cors)) headers.set(k, v);
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	const signer = signerOrigin ? ` "${signerOrigin}"` : '';
	headers.set(
		'Permissions-Policy',
		`publickey-credentials-get=(self${signer}), publickey-credentials-create=(self), clipboard-write=(self${signer}), camera=(), microphone=(), geolocation=()`
	);
	if (url.pathname.startsWith('/api/')) headers.set('Cache-Control', 'no-store');
	return response;
};
