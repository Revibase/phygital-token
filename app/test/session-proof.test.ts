import { describe, expect, it } from 'vitest';

import { PROOF_PARAM, fromOtherSite, markProofs, openedLocation, withSessionProofs, type ProjectShortcuts } from '$lib/server/accessory/shortcuts';
import { PROOF_TTL_S, proofKey, proofKeySet, signSessionProof, verifySessionProof, type SessionProofClaims } from '$lib/server/session/proof';
import type { AdmitSession } from '$lib/server/session/cookies';
import { bytesToBase64, bytesToBase64Url } from '$lib/shared/encoding';
import type { AccessoryView } from '$lib/shared/types';

const SEED = new Uint8Array(32).map((_, i) => i + 1);
const key = proofKey(bytesToBase64Url(SEED))!;
const keys = [key];
const ISSUER = 'https://portal.revibase.com';
const NOW = 1_800_000_000_000;

const MINT = 'So11111111111111111111111111111111111111112';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const OTHER = 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w';
const accessory = { pda: 'PdaPdaPda', mint: MINT, linkedWallet: OWNER, kind: 'controlled' } as AccessoryView;
const tap: AdmitSession = { v: 1, t: 'bu', sid: 's', pda: 'PdaPdaPda', identifier: 'id', exp: NOW + 10 * 60_000 };
const owner: AdmitSession = { v: 1, t: 'ob', sid: 's', pda: 'PdaPdaPda', identifier: 'id', wallet: OWNER, exp: NOW + 12 * 3600_000 };

const project: ProjectShortcuts = {
	externalUrl: 'https://game.xyz',
	shortcuts: [
		{ label: 'Play', href: 'https://app.game.xyz/play?card=1', icon: 'gaming', image: null, immerse: false, proof: false, external: false, platform: 'all' },
		{ label: 'Leaderboard', href: 'https://game.xyz/top', icon: 'leaderboard', image: null, immerse: false, proof: false, external: true, platform: 'all' },
		{ label: 'Discord', href: 'https://discord.gg/game', icon: 'discord', image: null, immerse: false, proof: false, external: true, platform: 'all' },
		{ label: 'Tip', href: `solana:${OWNER}?amount=1`, icon: 'tip', image: null, immerse: false, proof: false, external: true, platform: 'mobile' }
	]
};

const proofOf = (href: string) => new URL(href).searchParams.get(PROOF_PARAM);
const verify = (href: string, now = NOW) => verifySessionProof(proofOf(href)!, keys, { issuer: ISSUER, audience: new URL(href).origin, now });

describe('proofKey', () => {
	it('reads a 32-byte seed as base64url or base64, and publishes it as a JWKS', () => {
		expect(proofKey(bytesToBase64(SEED))?.kid).toBe(key.kid);
		expect(proofKey('too-short')).toBeNull();
		expect(proofKey(undefined)).toBeNull();
		const set = proofKeySet(key, ISSUER);
		expect(set.keys).toEqual([{ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: key.kid, x: bytesToBase64Url(key.publicKey) }]);
		expect(JSON.stringify(set)).not.toContain(bytesToBase64Url(SEED));
	});
});

describe('signSessionProof / verifySessionProof', () => {
	const claims: SessionProofClaims = {
		iss: ISSUER,
		aud: 'https://game.xyz',
		iat: NOW / 1000,
		exp: NOW / 1000 + 60,
		jti: 'j',
		sub: 'PdaPdaPda',
		mint: MINT,
		kind: 'bearer',
		wallet: null,
		authentication: 'accessory'
	};
	const token = signSessionProof(key, claims);
	const expect_ = { issuer: ISSUER, audience: 'https://game.xyz', now: NOW };

	it('round-trips', () => {
		expect(verifySessionProof(token, keys, expect_)).toEqual(claims);
	});

	it('rejects another audience, issuer, an expired proof, tampering and unknown keys', () => {
		expect(verifySessionProof(token, keys, { ...expect_, audience: 'https://evil.test' })).toBeNull();
		expect(verifySessionProof(token, keys, { ...expect_, issuer: 'https://evil.test' })).toBeNull();
		expect(verifySessionProof(token, keys, { ...expect_, now: NOW + 61_000 })).toBeNull();
		const [h, , s] = token.split('.');
		const forged = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ ...claims, wallet: OWNER })));
		expect(verifySessionProof(`${h}.${forged}.${s}`, keys, expect_)).toBeNull();
		const stranger = proofKey(bytesToBase64Url(new Uint8Array(32).fill(9)))!;
		expect(verifySessionProof(signSessionProof(stranger, claims), keys, expect_)).toBeNull();
		expect(verifySessionProof('a.b', keys, expect_)).toBeNull();
	});
});

describe('markProofs (the list the page holds)', () => {
	it('marks every listed HTTPS destination without signing anything', () => {
		const marked = markProofs(project, { key, issuer: ISSUER, session: tap, accessory, now: NOW });
		expect(marked.map((s) => s.proof)).toEqual([true, true, true, false]);
		expect(marked.map((s) => s.href)).toEqual(project.shortcuts.map((s) => s.href));
		expect(JSON.stringify(marked)).not.toContain(PROOF_PARAM);
	});

	it('marks nothing when no proof would be issued', () => {
		const none = (m: ReturnType<typeof markProofs>) => m.every((s) => !s.proof);
		expect(none(markProofs(project, { key: null, issuer: ISSUER, session: tap, accessory, now: NOW }))).toBe(true);
		expect(none(markProofs(project, { key, issuer: ISSUER, session: owner, accessory: { ...accessory, linkedWallet: OTHER }, now: NOW }))).toBe(true);
		expect(none(markProofs(project, { key, issuer: ISSUER, session: { ...tap, exp: NOW }, accessory, now: NOW }))).toBe(true);
	});
});

describe('opening a shortcut (/shortcut/[n])', () => {
	const [play, board, discord] = withSessionProofs(project, { key, issuer: ISSUER, session: tap, accessory, now: NOW });
	const ORIGIN = 'https://portal.revibase.com';

	it('sends the viewer to the freshly proven link', () => {
		expect(play.proof).toBe(true);
		expect(openedLocation(play, null, ORIGIN)).toBe(play.href);
		expect(proofOf(openedLocation(play, null, ORIGIN)!)).toBeTruthy();
	});

	it('wraps a wallet shortcut in the chosen wallet’s browse link, proof included', () => {
		const location = openedLocation(play, 'phantom', ORIGIN)!;
		expect(location).toBe(`https://phantom.app/ul/browse/${encodeURIComponent(play.href)}?ref=${encodeURIComponent(ORIGIN)}`);
		expect(openedLocation(play, 'metamask', ORIGIN)).toBe(play.href);
		expect(openedLocation(board, 'phantom', ORIGIN)).toBe(board.href); // external links are never wrapped
	});

	it('serves only shortcuts that got a proof, so it is never a general redirect', () => {
		expect(discord.proof).toBe(true);
		expect(openedLocation(discord, null, ORIGIN)).toBe(discord.href);
		expect(openedLocation({ ...discord, proof: false }, null, ORIGIN)).toBeNull();
	});

	it('refuses navigations started on another site', () => {
		expect(fromOtherSite(new Headers({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
		expect(fromOtherSite(new Headers({ 'sec-fetch-site': 'same-site' }))).toBe(true);
		expect(fromOtherSite(new Headers({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
		expect(fromOtherSite(new Headers({ 'sec-fetch-site': 'none' }))).toBe(true);
		expect(fromOtherSite(new Headers())).toBe(false); // browsers that don't send it
	});
});

describe('withSessionProofs', () => {
	it('proves every listed HTTPS destination, one audience each', () => {
		const out = withSessionProofs(project, { key, issuer: ISSUER, session: tap, accessory, now: NOW });
		const [play, board, discord, pay] = out;

		expect(verify(play.href)).toMatchObject({ aud: 'https://app.game.xyz', sub: 'PdaPdaPda', mint: MINT, kind: 'controlled', wallet: OWNER, authentication: 'accessory' });
		expect(new URL(play.href).searchParams.get('card')).toBe('1');
		expect(verify(board.href)?.aud).toBe('https://game.xyz');
		expect(verify(play.href)?.jti).not.toBe(verify(board.href)?.jti);
		// A proof for one origin doesn't verify at another.
		expect(verifySessionProof(proofOf(play.href)!, keys, { issuer: ISSUER, audience: 'https://game.xyz', now: NOW })).toBeNull();

		expect(verify(discord.href)).toMatchObject({ aud: 'https://discord.gg', authentication: 'accessory', wallet: OWNER });
		expect(pay.href).toBe(project.shortcuts[3].href);
	});

	it('expires in five minutes, never after the viewer’s own session', () => {
		const [play] = withSessionProofs(project, { key, issuer: ISSUER, session: tap, accessory, now: NOW });
		expect(verify(play.href)!.exp - NOW / 1000).toBe(PROOF_TTL_S);
		const ending = { ...tap, exp: NOW + 30_000 };
		const [soon] = withSessionProofs(project, { key, issuer: ISSUER, session: ending, accessory, now: NOW });
		expect(verify(soon.href)!.exp).toBe((NOW + 30_000) / 1000);
		expect(withSessionProofs(project, { key, issuer: ISSUER, session: { ...tap, exp: NOW }, accessory, now: NOW })).toBe(project.shortcuts);
	});

	it('proves an owner session the same way, only while that wallet is still linked', () => {
		const [play] = withSessionProofs(project, { key, issuer: ISSUER, session: owner, accessory, now: NOW });
		expect(verify(play.href)).toMatchObject({ wallet: OWNER, authentication: 'wallet' });
		const moved = { ...accessory, linkedWallet: OTHER };
		expect(withSessionProofs(project, { key, issuer: ISSUER, session: owner, accessory: moved, now: NOW })).toBe(project.shortcuts);
	});

	it('adds nothing when proofs are off or there is no project host', () => {
		expect(withSessionProofs(project, { key: null, issuer: ISSUER, session: tap, accessory, now: NOW })).toBe(project.shortcuts);
		expect(withSessionProofs({ ...project, externalUrl: null }, { key, issuer: ISSUER, session: tap, accessory, now: NOW })).toBe(project.shortcuts);
	});
});
