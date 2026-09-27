import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';

/**
 * Stateless, HMAC-SHA256-signed session cookies.
 *
 * - `acc`  — accessory session from a verified, counter-consumed NFC tap.
 * - `hof`  — handoff finisher: the one wallet context that claimed `h`.
 * - `dsk`  — desktop finisher bound when the desktop starts a pairing.
 * - `pair` — phone that scanned the desktop QR (claimed `p`).
 *
 * All are HttpOnly + SameSite=Lax + Secure, with the `__Host-` prefix in
 * production so they cannot be set by a subdomain or scoped to a sub-path.
 */

export const ACCESSORY_SESSION_TTL_MS = 10 * 60 * 1000;
export const FINISHER_SESSION_TTL_MS = 10 * 60 * 1000;

export type AccessorySession = { v: 1; t: 'acc'; sid: string; pda: string; identifier: string; exp: number };
export type FinisherSession = { v: 1; t: 'hof' | 'dsk'; sid: string; linkId: string; exp: number };
export type PairSession = { v: 1; t: 'pair'; sid: string; linkId: string; exp: number };
type AnySession = AccessorySession | FinisherSession | PairSession;

const NAMES = {
	acc: dev ? 'acc' : '__Host-acc',
	hof: dev ? 'hof' : '__Host-hof',
	dsk: dev ? 'dsk' : '__Host-dsk',
	pair: dev ? 'pair' : '__Host-pair'
} as const;

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (!key) {
		key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
			'sign',
			'verify'
		]);
		keyCache.set(secret, key);
	}
	return key;
}

export async function hmac(secret: string, data: string): Promise<Uint8Array> {
	const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
	return new Uint8Array(sig);
}

export async function signToken(secret: string, payload: AnySession): Promise<string> {
	const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
	const mac = bytesToBase64Url(await hmac(secret, body));
	return `${body}.${mac}`;
}

export async function verifyToken<T extends AnySession>(
	secret: string,
	token: string | undefined,
	type: T['t'],
	now = Date.now()
): Promise<T | null> {
	if (!token) return null;
	const [body, mac, extra] = token.split('.');
	if (!body || !mac || extra !== undefined) return null;
	let valid = false;
	try {
		valid = await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret),
			base64UrlToBytes(mac),
			encoder.encode(body)
		);
	} catch {
		return null;
	}
	if (!valid) return null;
	try {
		const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as AnySession;
		if (payload.v !== 1 || payload.t !== type || typeof payload.exp !== 'number' || payload.exp <= now) {
			return null;
		}
		return payload as T;
	} catch {
		return null;
	}
}

export function newSessionId(): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

async function writeCookie(cookies: Cookies, secret: string, payload: AnySession) {
	cookies.set(NAMES[payload.t], await signToken(secret, payload), {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: Math.max(1, Math.floor((payload.exp - Date.now()) / 1000))
	});
}

export function clearCookie(cookies: Cookies, t: AnySession['t']) {
	cookies.delete(NAMES[t], { path: '/', secure: !dev });
}

export async function setAccessorySession(
	cookies: Cookies,
	secret: string,
	data: { pda: string; identifier: string },
	now = Date.now()
): Promise<AccessorySession> {
	const session: AccessorySession = { v: 1, t: 'acc', sid: newSessionId(), ...data, exp: now + ACCESSORY_SESSION_TTL_MS };
	await writeCookie(cookies, secret, session);
	return session;
}

export async function setFinisherSession(
	cookies: Cookies,
	secret: string,
	t: FinisherSession['t'],
	linkId: string,
	now = Date.now()
): Promise<FinisherSession> {
	const session: FinisherSession = { v: 1, t, sid: newSessionId(), linkId, exp: now + FINISHER_SESSION_TTL_MS };
	await writeCookie(cookies, secret, session);
	return session;
}

export async function setPairSession(
	cookies: Cookies,
	secret: string,
	linkId: string,
	now = Date.now()
): Promise<PairSession> {
	const session: PairSession = { v: 1, t: 'pair', sid: newSessionId(), linkId, exp: now + FINISHER_SESSION_TTL_MS };
	await writeCookie(cookies, secret, session);
	return session;
}

export function readAccessorySession(cookies: Cookies, secret: string) {
	return verifyToken<AccessorySession>(secret, cookies.get(NAMES.acc), 'acc');
}

export function readFinisherSession(cookies: Cookies, secret: string, t: FinisherSession['t']) {
	return verifyToken<FinisherSession>(secret, cookies.get(NAMES[t]), t);
}

export function readPairSession(cookies: Cookies, secret: string) {
	return verifyToken<PairSession>(secret, cookies.get(NAMES.pair), 'pair');
}
