import { sha256 } from '@noble/hashes/sha2.js';

import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from '$lib/shared/encoding';
import { hmac } from '../session/cookies';

/**
 * Single-use, 256-bit capabilities that travel only in URL fragments
 * (`/continue#h=…`, `/pair#p=…`). The server stores sha256(token) only.
 */
export function mintCapability(): { token: string; hash: string } {
	const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	return { token, hash: hashCapability(token) };
}

export function hashCapability(token: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(token)));
}

export function isWellFormedCapability(token: unknown): token is string {
	if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
	return base64UrlToBytes(token).length === 32;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function pairingCode(secret: string, linkId: string, pda: string): Promise<string> {
	const mac = await hmac(secret, `pair:${linkId}:${pda}`);
	let code = '';
	for (let i = 0; i < 4; i++) code += CODE_ALPHABET[mac[i] % CODE_ALPHABET.length];
	return code;
}
