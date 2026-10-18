import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { address, generateKeyPairSigner, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
	findPhygitalTokenPda,
	type AuthenticationResponseJSON,
	type PhygitalToken,
	type TransferSession
} from 'phygital-token-sdk';

import { bytesToBase64Url } from '$lib/shared/encoding';
import type { LinkTap } from '$lib/shared/link-transaction';

export const RP_ID = 'accessory.test';
export const ORIGIN = 'https://accessory.test';

export function fakeAccessory() {
	const priv = p256.utils.randomSecretKey();
	const publicKey = p256.getPublicKey(priv);
	const identifier = p256.getPublicKey(p256.utils.randomSecretKey());
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
				mint: address('11111111111111111111111111111111'),
				lastSignCount: 3,
				tokenType: 1,
				bump: 0,
				publicKey: [publicKey],
				identifier: [identifier],
				...overrides
			};
		},
		assert(challenge: Uint8Array, opts: { highS?: boolean } = {}): AuthenticationResponseJSON {
			const clientData = new TextEncoder().encode(
				JSON.stringify({
					type: 'webauthn.get',
					challenge: bytesToBase64Url(challenge),
					origin: ORIGIN,
					crossOrigin: false
				})
			);
			const authData = new Uint8Array(37);
			authData.set(sha256(new TextEncoder().encode(RP_ID)), 0);
			authData[32] = 0x01;
			new DataView(authData.buffer).setUint32(33, 4, false);
			const signed = new Uint8Array(authData.length + 32);
			signed.set(authData);
			signed.set(sha256(clientData), authData.length);
			let sig = p256.Signature.fromBytes(p256.sign(signed, priv), 'compact');
			if (!!opts.highS !== sig.hasHighS())
				sig = new p256.Signature(sig.r, p256.Point.CURVE().n - sig.s);
			const der = sig.toBytes('der');
			return {
				id: bytesToBase64Url(publicKey),
				rawId: bytesToBase64Url(publicKey),
				type: 'public-key',
				clientExtensionResults: {},
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
	const slotHash = crypto.getRandomValues(new Uint8Array(32));
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const recipient = await generateKeyPairSigner();
	const session: TransferSession = {
		rpc: {} as Rpc<SolanaRpcApi>,
		phygitalToken: address(await acc.pda()),
		owner: null,
		secp256r1Pubkey: acc.publicKeyB64,
		slotNumber: 123456n,
		slotHash,
		challenge,
		rpId: RP_ID,
		recipient: recipient.address
	};
	const tap: LinkTap = { session, response: acc.assert(challenge) };
	return { acc, tap, recipient };
}
