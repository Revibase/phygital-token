import { json } from '@sveltejs/kit';
import {
	getBase58Decoder,
	getBase64EncodedWireTransaction,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	isTransactionWithinSizeLimit,
	lamports,
	signBytes,
	type SignatureBytes
} from '@solana/kit';

import { getEnv, getRpc } from '#lib/server/env.ts';
import { feePayerSigner, sha256 } from '#lib/server/fee-payer/key.ts';
import { breaksEven, inspectRelayedTransaction } from '#lib/server/fee-payer/policy.ts';
import { readJsonObject } from '#lib/server/http/read-json.ts';
import { base64ToBytes } from '#lib/shared/encoding.ts';
import type { RequestHandler } from './$types';

/** Below this the fee payer stops relaying, so it can always front a wallet's rent. */
const FEE_PAYER_MIN_BALANCE = 50_000_000n;

const refused = (error: string, status = 403, code = 'fee_payer_refused') =>
	json({ error, code }, { status });

/**
 * Relay a Revibase Passkey transaction: check it pays the fee payer back
 * exactly (fee, plus the wallet's rent if it creates it), sign last as fee
 * payer, and submit it. The signature is only returned once the transaction
 * is submitted, so it can never be held and landed later.
 * Rate-limited by a Cloudflare dashboard rule.
 */
export const POST: RequestHandler = async ({ request }) => {
	const env = getEnv();
	if (!env.passkey) return refused('The passkey wallet isn’t available here.', 404);
	const read = await readJsonObject(request);
	if (!read.ok) return read.response;
	const { transaction } = read.body as { transaction?: unknown };
	// Base64 of the largest (v1, 4096-byte) transaction.
	if (typeof transaction !== 'string' || transaction.length > 5464)
		return json({ error: 'Missing transaction.', code: 'bad_request' }, { status: 400 });

	let wireBytes: Uint8Array;
	try {
		wireBytes = base64ToBytes(transaction);
	} catch {
		return json({ error: 'Missing transaction.', code: 'bad_request' }, { status: 400 });
	}

	const signer = await feePayerSigner(env.passkey.feePayerKey);
	const decision = await inspectRelayedTransaction(wireBytes, {
		feePayer: signer.address,
		signerRpIdHash: await sha256(new URL(env.passkey.signerOrigin).hostname)
	});
	if (!decision.ok) return refused(`Revibase won’t send this: ${decision.reason}.`);

	const tx = getTransactionDecoder().decode(wireBytes);
	if (!isTransactionWithinSizeLimit(tx))
		return refused('This transaction is too large to send.', 422, 'transaction_changed');

	const rpc = getRpc(env);
	const [{ value: balance }, { value: sim }] = await Promise.all([
		rpc.getBalance(signer.address, { commitment: 'confirmed' }).send(),
		rpc
			.simulateTransaction(getBase64EncodedWireTransaction(tx), {
				encoding: 'base64',
				sigVerify: false,
				replaceRecentBlockhash: false,
				commitment: 'confirmed'
			})
			.send()
	]);
	if (balance < lamports(FEE_PAYER_MIN_BALANCE))
		return refused('Revibase can’t send transactions right now.', 503, 'fee_payer_unavailable');
	if (sim.err) return refused('This transaction would fail.', 422, 'transaction_changed');

	// Break even exactly: paid back the fee plus the rent create_wallet actually takes.
	const keys = getCompiledTransactionMessageDecoder().decode(tx.messageBytes).staticAccounts;
	const delta = (address: string) => {
		const i = keys.indexOf(address as (typeof keys)[number]);
		const pre = sim.preBalances?.[i];
		const post = sim.postBalances?.[i];
		return i < 0 || pre == null || post == null ? null : BigInt(post) - BigInt(pre);
	};
	const rent = decision.createdWallet ? delta(decision.createdWallet) : 0n;
	const feePayerChange = delta(signer.address);
	if (rent === null || feePayerChange === null)
		return refused('This transaction couldn’t be checked.', 422, 'transaction_changed');
	if (!breaksEven({ payment: decision.payment, fee: decision.fee, rent, feePayerChange }))
		return refused('The network fee changed. Review and try again.', 422, 'transaction_changed');

	const signature = (await signBytes(
		signer.keyPair.privateKey,
		decision.messageBytes
	)) as SignatureBytes;
	const signed = { ...tx, signatures: { ...tx.signatures, [signer.address]: signature } };
	try {
		await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} catch {
		return refused('This transaction couldn’t be sent. Try again.', 422, 'transaction_changed');
	}
	return json({ signature: getBase58Decoder().decode(signature) });
};
