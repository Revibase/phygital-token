import {
	appendTransactionMessageInstructions,
	createKeyPairSignerFromBytes,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type Instruction,
	type Rpc,
	type Signature,
	type SolanaRpcApi,
	type TransactionSigner,
	type V1TransactionConfig
} from '@solana/kit';

import { pollConfirmation } from '#lib/shared/confirm.ts';
import { base64ToBytes } from '#lib/shared/encoding.ts';
import { ConfigError } from '../env';

/** AdminConfig's issuer, from its base64 64-byte secret key. It signs `initialize` and pays its rent. */
export async function issuerSigner(env: Cloudflare.Env): Promise<TransactionSigner> {
	const secret = env.ISSUER_SECRET_KEY;
	if (!secret) throw new ConfigError('ISSUER_SECRET_KEY is missing');
	const bytes = base64ToBytes(secret);
	if (bytes.length !== 64) throw new ConfigError('ISSUER_SECRET_KEY must be 64 bytes (base64)');
	return createKeyPairSignerFromBytes(bytes);
}

/**
 * Send `instructions` as one version 1 transaction under `budget` and wait
 * until it is confirmed. The RPC's preflight simulates it first, so a failing
 * transaction throws Kit's preflight error, with the program logs in its
 * `context`, before any fee is paid.
 */
export async function signAndSend(
	rpc: Rpc<SolanaRpcApi>,
	feePayer: TransactionSigner,
	instructions: Instruction[],
	budget: V1TransactionConfig
): Promise<Signature> {
	const { value: latestBlockhash } = await rpc
		.getLatestBlockhash({ commitment: 'confirmed' })
		.send();
	const signed = await signTransactionMessageWithSigners(
		pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayerSigner(feePayer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
			(m) => appendTransactionMessageInstructions(instructions, m),
			(m) => setTransactionMessageConfig(budget, m)
		)
	);

	const signature = getSignatureFromTransaction(signed);
	await rpc
		.sendTransaction(getBase64EncodedWireTransaction(signed), {
			encoding: 'base64',
			preflightCommitment: 'confirmed'
		})
		.send();
	const { lastValidBlockHeight } = latestBlockhash;
	await pollConfirmation(rpc, signature, {
		pollMs: 1_000,
		expired: async () =>
			(await rpc.getBlockHeight({ commitment: 'confirmed' }).send()) > lastValidBlockHeight
				? new Error(`Transaction ${signature} expired before it was confirmed.`)
				: null
	});
	return signature;
}
