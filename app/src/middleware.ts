import { NextResponse, type NextRequest } from 'next/server';

import { getEnv } from '#lib/server/env.ts';
import {
	ADMIT_PDA_HEADER,
	readAdmitSession,
	readBrowseUnlock,
	type CookieJar
} from '#lib/server/session/cookies.ts';
import { hasTapParams } from '#lib/server/tap/params.ts';

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;
	if (pathname.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD') {
		if (request.headers.get('origin') !== request.nextUrl.origin) {
			return NextResponse.json(
				{ error: 'Cross-site request blocked.', code: 'forbidden' },
				{ status: 403 }
			);
		}
	}

	const response = await gate(request);
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	response.headers.set('Content-Security-Policy', contentSecurityPolicy());
	response.headers.set(
		'Permissions-Policy',
		'publickey-credentials-get=*, clipboard-write=*, camera=(), microphone=(), geolocation=()'
	);
	if (pathname.startsWith('/api/') || pathname.startsWith('/accessory')) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
}

/**
 * `/accessory` needs an admit cookie (a tap, or the owner opening it).
 * `/accessory/link` needs browse_unlock. owner_browse is view-only.
 * A signed NFC URL is sent to the landing route, which issues browse_unlock.
 */
async function gate(request: NextRequest): Promise<NextResponse> {
	const { pathname } = request.nextUrl;
	const link = pathname === '/accessory/link';
	if (pathname !== '/accessory' && !link) return continueWith(request);

	if (!link && hasTapParams(request.nextUrl.searchParams)) {
		const landing = request.nextUrl.clone();
		landing.pathname = '/api/tap/landing';
		return NextResponse.redirect(landing);
	}

	const env = await getEnv();
	const session = link
		? await readBrowseUnlock(readOnlyCookies(request), env.SESSION_SECRET)
		: await readAdmitSession(readOnlyCookies(request), env.SESSION_SECRET);
	if (!session) {
		const expired = request.nextUrl.clone();
		expired.pathname = '/tap/expired';
		expired.search = '';
		return NextResponse.redirect(expired);
	}
	return continueWith(request, session.pda);
}

function continueWith(request: NextRequest, pda?: string): NextResponse {
	const headers = new Headers(request.headers);
	if (pda) headers.set(ADMIT_PDA_HEADER, pda);
	else headers.delete(ADMIT_PDA_HEADER);
	return NextResponse.next({ request: { headers } });
}

function readOnlyCookies(request: NextRequest): CookieJar {
	return {
		get: (name) => request.cookies.get(name)?.value,
		set: () => {
			throw new Error('Middleware only reads session cookies.');
		},
		delete: () => {
			throw new Error('Middleware only reads session cookies.');
		}
	};
}

function contentSecurityPolicy(): string {
	const dev = process.env.NODE_ENV !== 'production';
	return [
		"default-src 'self'",
		`script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://auth.privy.io${dev ? " 'unsafe-eval'" : ''}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss:",
		`frame-src https: https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org${dev ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'"
	].join('; ');
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|webmanifest|txt)$).*)']
};
