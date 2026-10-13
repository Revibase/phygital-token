import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { VirtualAuthenticator, type Tamper } from './support/authenticator';

import { issueResumeChallenge, verifyResume } from '$lib/server/tap/resume';
import { bytesToBase64Url } from '$lib/shared/encoding';
import { createTestD1, MIGRATIONS } from './support/d1-sqlite';

const APP = 'https://portal.revibase.test';
const RP_ID = 'revibase.test';
const b64url = (b: ArrayBuffer) => bytesToBase64Url(new Uint8Array(b));

/** No accessory is registered: a tap that passes verification reaches the lookup and stops there. */
const rpc = {
	getAccountInfo: () => ({ send: async () => ({ value: null }) })
} as unknown as Rpc<SolanaRpcApi>;

async function tap(tamper?: Tamper) {
	const db = createTestD1([MIGRATIONS]);
	const va = new VirtualAuthenticator();
	va.importAccessory(p256.utils.randomSecretKey());
	const { challengeId, message } = await issueResumeChallenge(db);
	if (tamper) va.tamperNext(tamper);
	const cred = await va.get(
		{
			publicKey: {
				challenge: new TextEncoder().encode(message),
				rpId: RP_ID,
				allowCredentials: [{ type: 'public-key', id: new Uint8Array(33), transports: ['nfc'] }]
			}
		},
		{ origin: APP }
	);
	const response = {
		id: cred.id,
		rawId: cred.id,
		type: 'public-key',
		response: {
			clientDataJSON: b64url(cred.response.clientDataJSON),
			authenticatorData: b64url(cred.response.authenticatorData),
			signature: b64url(cred.response.signature)
		}
	};
	const deps = { db, rpc, origin: APP, rpId: RP_ID };
	return { deps, input: { challengeId, response } };
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
