import { env } from 'cloudflare:workers';
import { passkeyEnv } from '#lib/server/passkey-env.ts';
import { feePayerSigner } from '#lib/server/fee-payer/key.ts';
import type { LayoutServerLoad } from './$types';

function payAppOrigin(raw: string | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
		return url.origin;
	} catch {
		return null;
	}
}

/** Revibase Passkey is offered only with a signer and a fee payer; a bad key just hides it. */
async function passkeySigner(): Promise<{ origin: string; feePayer: string } | null> {
	const config = passkeyEnv(env.SECURE_SIGNER_ORIGIN, env.FEE_PAYER_KEY);
	if (!config) return null;
	try {
		const signer = await feePayerSigner(config.feePayerKey);
		return { origin: config.signerOrigin, feePayer: signer.address };
	} catch (err) {
		console.error('FEE_PAYER_KEY is not a base58 64-byte secret key', err);
		return null;
	}
}

export const load: LayoutServerLoad = async () => ({
	cluster: (env.SOLANA_CLUSTER ?? 'devnet') as 'mainnet' | 'devnet' | 'testnet' | 'localnet',
	rpcUrl: env.SOLANA_RPC_URL ?? '',
	payAppOrigin: payAppOrigin(env.PAY_APP_ORIGIN),
	passkeySigner: await passkeySigner()
});
