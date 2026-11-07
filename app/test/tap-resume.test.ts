import { describe, expect, it } from 'vitest';
import type { Rpc, SolanaRpcApi } from '@solana/kit';

import { issueResumeChallenge, verifyResume } from '#lib/server/tap/resume.ts';
import { createTestD1 } from './support/d1-sqlite';
import { fakeAccessory } from './support/fixtures';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** No accessory is registered: a tap that passes verification reaches the lookup and stops there. */
const rpc = {
	getAccountInfo: () => ({ send: async () => ({ value: null }) })
} as unknown as Rpc<SolanaRpcApi>;

type Tamper = { wrongMessage?: string };

async function tap(tamper: Tamper = {}) {
	const db = createTestD1();
	const { challengeId, message } = await issueResumeChallenge(db);
	const response = fakeAccessory().assert(utf8(tamper.wrongMessage ?? message));
	return { deps: { db, rpc }, input: { challengeId, response } };
}

describe('tap resume', () => {
	it('accepts a genuine tap for this site (then looks the accessory up)', async () => {
		const { deps, input } = await tap();
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'unknown_accessory' });
	});

	it('rejects a tap over the wrong message', async () => {
		const { deps, input } = await tap({ wrongMessage: 'not-the-challenge' });
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'tap_rejected' });
	});

	it('uses each challenge once', async () => {
		const { deps, input } = await tap();
		await verifyResume(deps, input);
		expect(await verifyResume(deps, input)).toMatchObject({ ok: false, code: 'too_slow' });
	});
});
