import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';

import { base64UrlToBytes, bytesToBase64Url } from '$lib/shared/encoding';

/**
 * Stateless, HMAC-SHA256-signed session cookies.
 *
 * Admit (opens `/accessory`):
 * - `bu`  — browse_unlock: physical possession (NFC tap or WebAuthn Hold).
 * - `ob`  — owner_browse: the linked wallet owns this accessory (no tap needed).
 *   Issued from `os` alone, so opening an accessory never asks for a signature.
 *
 * Login:
 * - `os`  — owner_session: this browser proved control of a wallet (one signMessage).
 *
 * Ceremony:
 * - `hof`  — handoff finisher: the one wallet context that claimed `h`.
 * - `dsk`  — desktop finisher bound when the desktop starts a pairing.
 * - `pair` — phone that scanned the desktop QR (claimed `p`).
 *
 * Purpose is bound into the token (`t`), so a browse_unlock cookie never
 * verifies as owner_browse (and vice versa). Matches phygital-wallet's
 * browse_unlock / authority_browse admit model.
 *
 * All are HttpOnly + SameSite=Lax + Secure, with the `__Host-` prefix in
 * production so they cannot be set by a subdomain or scoped to a sub-path.
 */

export const BROWSE_SESSION_TTL_MS = 10 * 60 * 1000;
export const FINISHER_SESSION_TTL_MS = 10 * 60 * 1000;
/** Wallet login lifetime (phygital-wallet's authority session). */
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Physical-possession admit. Seed of the link ceremony. */
export type BrowseUnlockSession = {
	v: 1;
	t: 'bu';
	sid: string;
	pda: string;
	identifier: string;
	exp: number;
};

/** Owner admit: linked wallet opened this accessory from Home. */
export type OwnerBrowseSession = {
	v: 1;
	t: 'ob';
	sid: string;
	pda: string;
	identifier: string;
	/** The linked wallet that signed to open it. */
	wallet: string;
	exp: number;
};

/** Wallet login: proof this browser controls `wallet`. Not an admit on its own. */
export type OwnerSession = { v: 1; t: 'os'; sid: string; wallet: string; exp: number };

/** Either admit cookie — enough to view `/accessory`. */
export type AdmitSession = BrowseUnlockSession | OwnerBrowseSession;

export type FinisherSession = { v: 1; t: 'hof' | 'dsk'; sid: string; linkId: string; exp: number };
export type PairSession = { v: 1; t: 'pair'; sid: string; linkId: string; exp: number };
type AnySession = BrowseUnlockSession | OwnerBrowseSession | OwnerSession | FinisherSession | PairSession;

const NAMES = {
	bu: dev ? 'bu' : '__Host-bu',
	ob: dev ? 'ob' : '__Host-ob',
	os: dev ? 'os' : '__Host-os',
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

/** Issue browse_unlock. A physical tap always replaces leftover owner_browse. */
export async function setBrowseUnlock(
	cookies: Cookies,
	secret: string,
	data: { pda: string; identifier: string },
	now = Date.now()
): Promise<BrowseUnlockSession> {
	clearCookie(cookies, 'ob');
	const session: BrowseUnlockSession = {
		v: 1,
		t: 'bu',
		sid: newSessionId(),
		...data,
		exp: now + BROWSE_SESSION_TTL_MS
	};
	await writeCookie(cookies, secret, session);
	return session;
}

/** Issue owner_browse. Clears browse_unlock so one admit cookie is live. */
export async function setOwnerBrowse(
	cookies: Cookies,
	secret: string,
	data: { pda: string; identifier: string; wallet: string },
	now = Date.now()
): Promise<OwnerBrowseSession> {
	clearCookie(cookies, 'bu');
	const session: OwnerBrowseSession = {
		v: 1,
		t: 'ob',
		sid: newSessionId(),
		...data,
		exp: now + BROWSE_SESSION_TTL_MS
	};
	await writeCookie(cookies, secret, session);
	return session;
}

export async function setOwnerSession(
	cookies: Cookies,
	secret: string,
	wallet: string,
	now = Date.now()
): Promise<OwnerSession> {
	const session: OwnerSession = { v: 1, t: 'os', sid: newSessionId(), wallet, exp: now + OWNER_SESSION_TTL_MS };
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

export function readBrowseUnlock(cookies: Cookies, secret: string) {
	return verifyToken<BrowseUnlockSession>(secret, cookies.get(NAMES.bu), 'bu');
}

export function readOwnerSession(cookies: Cookies, secret: string) {
	return verifyToken<OwnerSession>(secret, cookies.get(NAMES.os), 'os');
}

export function readOwnerBrowse(cookies: Cookies, secret: string) {
	return verifyToken<OwnerBrowseSession>(secret, cookies.get(NAMES.ob), 'ob');
}

/**
 * Admit for viewing `/accessory`: browse_unlock wins when both somehow remain
 * (a physical tap is fresher proof than an owner open).
 */
export async function readAdmitSession(cookies: Cookies, secret: string): Promise<AdmitSession | null> {
	const browse = await readBrowseUnlock(cookies, secret);
	if (browse) return browse;
	return readOwnerBrowse(cookies, secret);
}

export function readFinisherSession(cookies: Cookies, secret: string, t: FinisherSession['t']) {
	return verifyToken<FinisherSession>(secret, cookies.get(NAMES[t]), t);
}

export function readPairSession(cookies: Cookies, secret: string) {
	return verifyToken<PairSession>(secret, cookies.get(NAMES.pair), 'pair');
}
