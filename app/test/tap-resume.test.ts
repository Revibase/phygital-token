import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { issueResumeChallenge, verifyResume } from '#lib/server/tap/resume.ts';
import { bytesToBase64Url } from '#lib/shared/encoding.ts';
import { createTestD1, MIGRATIONS } from './support/d1-sqlite';

const APP = 'https://portal.revibase.test';
const RP_ID = 'revibase.test';
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = bytesToBase64Url;

/** No accessory is registered: a tap that passes verification reaches the lookup and stops there. */
const rpc = {
	getAccountInfo: () => ({ send: async () => ({ value: null }) })
} as unknown as Rpc<SolanaRpcApi>;

/** What a genuine tap would change: the ceremony type, origin, RP ID, or the user-present flag. */
type Tamper = { type?: string; origin?: string; rpId?: string; up?: false };

/** A WebAuthn assertion from an NFC accessory key over `message`, as the browser returns it. */
function assertion(message: string, tamper: Tamper = {}) {
	const key = p256.utils.randomSecretKey();
	const id = b64url(p256.getPublicKey(key, true));
	const clientDataJSON = utf8(
		JSON.stringify({
			type: tamper.type ?? 'webauthn.get',
			challenge: b64url(utf8(message)),
			origin: tamper.origin ?? APP,
			crossOrigin: false
		})
	);
	// Flags: user present (unless tampered), user verified, backup eligible, backed up. Sign count 1.
	const flags = tamper.up === false ? 0x1c : 0x1d;
	const authenticatorData = new Uint8Array([
		...sha256(utf8(tamper.rpId ?? RP_ID)),
		flags,
		0,
		0,
		0,
		1
	]);
	const signature = p256.sign(
		new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]),
		key,
		{ format: 'der' }
	);
	return {
		id,
		rawId: id,
		type: 'public-key',
		response: {
			clientDataJSON: b64url(clientDataJSON),
			authenticatorData: b64url(authenticatorData),
			signature: b64url(signature)
		}
	};
}

async function tap(tamper?: Tamper) {
	const db = createTestD1([MIGRATIONS]);
	const { challengeId, message } = await issueResumeChallenge(db);
	const deps = { db, rpc, origin: APP, rpId: RP_ID };
	return { deps, input: { challengeId, response: assertion(message, tamper) } };
}

describe('tap resume', () => {
	it('accepts a genuine tap for this site (then looks the accessory up)', async () => {
		const { deps, input } = await tap();
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'unknown_accessory' });
	});

	it('rejects a tap for another relying party', async () => {
		const { deps, input } = await tap({ rpId: 'evil.example' });
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('rejects a tap without user presence', async () => {
		const { deps, input } = await tap({ up: false });
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('rejects a registration response', async () => {
		const { deps, input } = await tap({ type: 'webauthn.create' });
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('rejects a tap made on another site', async () => {
		const { deps, input } = await tap({ origin: 'https://evil.example' });
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('uses each challenge once', async () => {
		const { deps, input } = await tap();
		await verifyResume(deps, input);
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'too_slow' });
	});
});
