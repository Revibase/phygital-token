import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from '@solana/kit';

let loaded: { source: string; signer: Promise<KeyPairSigner> } | null = null;

/** `FEE_PAYER_KEY`: a base58 64-byte secret key, loaded once per isolate. */
export function feePayerSigner(secret: string): Promise<KeyPairSigner> {
	if (loaded?.source !== secret) {
		loaded = {
			source: secret,
			signer: createKeyPairSignerFromBytes(getBase58Encoder().encode(secret))
		};
		loaded.signer.catch(() => (loaded = null));
	}
	return loaded.signer;
}

export async function sha256(text: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
