/**
 * A minimal integrator page on its own origin (https://localhost:4300): pays from an
 * accessory wallet with a tap, as the developer docs describe. The e2e runner
 * calls `window.dapp.pay(...)` and reads the outcome.
 */
import {
	address,
	appendTransactionMessageInstructions,
	createSolanaRpc,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type Instruction
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getPhygitalWalletSigner } from 'phygital-token-sdk';

const rpc = createSolanaRpc('https://localhost:5173/__e2e/rpc');
const FEES = 'https://localhost:5173/api/sponsor';

type Outcome =
	{ ok: true; signature: string } | { ok: false; name: string; code?: string; message: string };

async function run(
	accessory: string,
	build: (wallet: Awaited<ReturnType<typeof getPhygitalWalletSigner>>) => Instruction[]
): Promise<Outcome> {
	try {
		const wallet = await getPhygitalWalletSigner(rpc, address(accessory), { feeEndpoint: FEES });
		const { value: lifetime } = await rpc.getLatestBlockhash().send();
		const message = pipe(
			createTransactionMessage({ version: 0 }),
			(m) => setTransactionMessageFeePayer(wallet.address, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
			(m) => appendTransactionMessageInstructions(build(wallet), m)
		);
		const signed = await signTransactionMessageWithSigners(message);
		const signature = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
		for (let i = 0; i < 60; i++) {
			const { value } = await rpc.getSignatureStatuses([signature]).send();
			const status = value[0];
			if (status?.err)
				return { ok: false, name: 'TransactionFailed', message: JSON.stringify(status.err) };
			if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized')
				return { ok: true, signature: getSignatureFromTransaction(signed) };
			await new Promise((r) => setTimeout(r, 500));
		}
		return { ok: false, name: 'Timeout', message: 'not confirmed' };
	} catch (e) {
		const err = e as { name?: string; code?: string; message?: string };
		return {
			ok: false,
			name: err.name ?? 'Error',
			code: err.code,
			message: err.message ?? String(e)
		};
	}
}

(window as unknown as { dapp: unknown }).dapp = {
	/** Pays `lamports` from the accessory wallet to `recipient`. */
	pay: (accessory: string, recipient: string, lamports: string) =>
		run(accessory, (wallet) => [
			getTransferSolInstruction({
				source: wallet,
				destination: address(recipient),
				amount: BigInt(lamports)
			})
		]),
	/** Asks the accessory to call a program the owner never allowed (Memo). */
	memo: (accessory: string) =>
		run(accessory, (wallet) => [
			{
				programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
				accounts: [{ address: wallet.address, role: 3, signer: wallet }],
				data: new TextEncoder().encode('not allowed')
			} as unknown as Instruction
		])
};
document.getElementById('status')!.textContent = 'loaded';
