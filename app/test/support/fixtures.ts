import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { address, Endian, generateKeyPairSigner, getU32Encoder } from '@solana/kit';
import {
	buildProductAllowListId,
	findPhygitalTokenPda,
	type AuthenticationResponseJSON,
	type PhygitalToken
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '#lib/shared/encoding.ts';
import type { TransferSession } from '#lib/shared/set-owner.ts';
import type { LinkTap } from '#lib/shared/link-transaction.ts';

export const RP_ID = 'accessory.test';
export const ORIGIN = 'https://accessory.test';

function encodeProductLargeBlob(publicKey: Uint8Array, signatureDer: Uint8Array): Uint8Array {
	const out = new Uint8Array(2 + 2 + publicKey.length + 2 + 1 + signatureDer.length);
	let i = 0;
	out[i++] = 0xa2;
	out[i++] = 0x01;
	out[i++] = 0x58;
	out[i++] = publicKey.length;
	out.set(publicKey, i);
	i += publicKey.length;
	out[i++] = 0x02;
	out[i++] = 0x58;
	out[i++] = signatureDer.length;
	out.set(signatureDer, i);
	return out;
}

export function fakeAccessory() {
	const priv = p256.utils.randomSecretKey();
	const publicKey = p256.getPublicKey(priv, true);
	const identifier = p256.getPublicKey(p256.utils.randomSecretKey(), true);
	return {
		publicKey,
		publicKeyB64: bytesToBase64Url(publicKey),
		identifier,
		async pda() {
			return String(await findPhygitalTokenPda(bytesToBase64Url(publicKey)));
		},
		account(overrides: Partial<PhygitalToken> = {}): PhygitalToken {
			return {
				discriminator: new Uint8Array(8),
				owner: address('11111111111111111111111111111111'),
				reserved: new Uint8Array(32),
				lastSlot: 3n,
				tokenType: 1,
				bump: 0,
				publicKey: [publicKey],
				identifier: [identifier],
				...overrides
			};
		},
		/** Product-key assert: signs authorize||payload; pubkey+sig in largeBlob. */
		assert(payload: Uint8Array, opts: { highS?: boolean } = {}): AuthenticationResponseJSON {
			const allowListId = buildProductAllowListId(payload);
			const clientData = new TextEncoder().encode(
				JSON.stringify({
					type: 'webauthn.get',
					challenge: bytesToBase64Url(allowListId),
					origin: ORIGIN,
					crossOrigin: false
				})
			);
			const authData = new Uint8Array(37);
			authData.set(sha256(new TextEncoder().encode(RP_ID)), 0);
			authData[32] = 0x01;
			let sig = p256.Signature.fromBytes(p256.sign(allowListId, priv), 'compact');
			if (!!opts.highS !== sig.hasHighS())
				sig = new p256.Signature(sig.r, p256.Point.CURVE().n - sig.s);
			const der = sig.toBytes('der');
			const blob = encodeProductLargeBlob(publicKey, der);
			return {
				id: bytesToBase64Url(allowListId),
				rawId: bytesToBase64Url(allowListId),
				type: 'public-key',
				clientExtensionResults: {
					largeBlob: { blob: bytesToBase64Url(blob) }
				},
				response: {
					clientDataJSON: bytesToBase64Url(clientData),
					authenticatorData: bytesToBase64Url(authData),
					signature: bytesToBase64Url(der)
				}
			};
		}
	};
}

export async function fakeTap(acc = fakeAccessory()) {
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const recipient = await generateKeyPairSigner();
	const session: TransferSession = {
		phygitalToken: address(await acc.pda()),
		secp256r1Pubkey: acc.publicKeyB64,
		slotNumber: 123456n,
		challenge,
		recipient: recipient.address
	};
	const tap: LinkTap = { session, response: acc.assert(challenge) };
	return { acc, tap, recipient };
}

/** An NDEF chip: `tap(counter)` builds its signed dynamic-URL params (`pk`, `s`, `c`, `n`). */
export function chip() {
	const priv = p256.utils.randomSecretKey();
	return {
		pk: p256.getPublicKey(priv),
		tap(counter: number, overrides: Record<string, string> = {}) {
			const nonce = crypto.getRandomValues(new Uint8Array(8));
			const message = new Uint8Array(12);
			message.set(getU32Encoder({ endian: Endian.Big }).encode(counter), 0);
			message.set(nonce, 4);
			const sig = p256.sign(message, priv);
			return new URLSearchParams({
				pk: bytesToBase64Url(p256.getPublicKey(priv)),
				s: bytesToBase64Url(sig),
				c: String(counter),
				n: bytesToBase64Url(nonce),
				...overrides
			});
		}
	};
}
