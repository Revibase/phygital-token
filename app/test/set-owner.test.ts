import { bytesToHex } from '@noble/curves/utils.js';
import { generateKeyPairSigner, getAddressDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { buildTransferChallenge, completeTransfer } from '#lib/shared/set-owner.ts';
import { fakeAccessory, fakeTap } from './support/fixtures';

const addr = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));

describe('set_owner challenge', () => {
	it("matches the program's vector (programs/phygital-token/tests/set_owner_challenge.rs)", () => {
		const challenge = buildTransferChallenge({
			phygitalToken: addr(2),
			recipient: addr(4),
			slotHash: new Uint8Array(32).fill(3)
		});
		expect(bytesToHex(challenge)).toBe(
			'23979b69fd7e8f781af25ca4dbd55bdf05ac0a4f6cf9094620b9eeddff5bfcce'
		);
	});
});

describe('completeTransfer', () => {
	it("returns the precompile then set_owner for the token's card", async () => {
		const { tap, recipient } = await fakeTap();
		const [secp, setOwner] = completeTransfer(tap.session, tap.response, recipient);
		expect(secp.programAddress).toBe('Secp256r1SigVerify1111111111111111111111111');
		expect(setOwner.accounts!.map((a) => a.address)).toContain(tap.session.phygitalToken);
	});

	it('refuses a tap from a different card', async () => {
		const { tap, recipient } = await fakeTap();
		const other = fakeAccessory();
		expect(() =>
			completeTransfer(
				{ ...tap.session, secp256r1Pubkey: other.publicKeyB64 },
				tap.response,
				recipient
			)
		).toThrow(expect.objectContaining({ code: 'INVALID_ASSERTION' }));
	});

	it('refuses a tap over another challenge, or a different signer', async () => {
		const { tap, recipient } = await fakeTap();
		expect(() =>
			completeTransfer({ ...tap.session, challenge: new Uint8Array(32) }, tap.response, recipient)
		).toThrow(expect.objectContaining({ code: 'INVALID_ASSERTION' }));
		const stranger = await generateKeyPairSigner();
		expect(() => completeTransfer(tap.session, tap.response, stranger)).toThrow(
			expect.objectContaining({ code: 'INVALID_ARGUMENT' })
		);
	});
});
