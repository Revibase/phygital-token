import {
	AccountRole,
	address,
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	getBase58Decoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit';
import {
	authenticatePasskeyForTransfer,
	beginTransfer,
	getRemoveOwnerInstruction,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	REMOVE_OWNER_DISCRIMINATOR,
	type AuthenticationResponseJSON,
	type TransferSession
} from 'phygital-token-sdk';
import { bytesEqual } from '#lib/shared/encoding.ts';
import { LINK_TX_CONFIG } from '#lib/shared/fee-policy.ts';
import {
	buildLinkTransactionFromTap,
	expectationFromTap,
	LinkTransactionRejected,
	type LinkTap,
	validateLinkTransaction
} from '#lib/shared/link-transaction.ts';
import { decodeMessage } from '#lib/shared/passkey-transaction.ts';
import { TAP_WINDOW_MS } from '#lib/shared/link-transaction.ts';
import { browserRpc } from '../rpc';
import { forgetWalletAccessories } from '../cache';
import { waitForConfirmation } from '../tx';
import { signWithWallet, type SigningContext } from '../wallet/wallet.svelte';

export type PreparedTap = { session: TransferSession; expiresAt: number };
export type TappedAccessory = PreparedTap & { response: AuthenticationResponseJSON };
export type FinishPhase = 'preparing' | 'approve' | 'confirming';

/** Fetch the slot-bound challenge, naming the connected wallet, before the user taps Approve. */
export async function prepareTap(
	secp256r1Pubkey: string,
	rpId: string,
	recipient: string
): Promise<PreparedTap> {
	const fetchedAt = Date.now();
	const session = await beginTransfer({
		rpc: browserRpc(),
		secp256r1Pubkey,
		rpId,
		recipient: address(recipient)
	});
	return { session, expiresAt: fetchedAt + TAP_WINDOW_MS };
}

/** WebAuthn must be called directly from the Approve click on iOS. */
export async function tapAccessory(prepared: PreparedTap): Promise<TappedAccessory> {
	return {
		...prepared,
		response: await authenticatePasskeyForTransfer(prepared.session)
	};
}

/**
 * Build, validate, sign and submit the claim directly through the wallet and Solana RPC.
 *
 * Revibase Passkey returns a different transaction: the claim runs through its
 * vault's `execute`, already co-signed by the Revibase fee payer.
 */
export async function finishLink(
	tap: LinkTap & { expiresAt: number },
	ctx: SigningContext,
	onPhase: (phase: FinishPhase) => void = () => {}
): Promise<string> {
	onPhase('preparing');
	const rpc = browserRpc();
	const recipient = createNoopSigner(address(ctx.address));
	const feePayer = address(ctx.feePayer);
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const [{ wireBytes }, tapExpectation] = await Promise.all([
		buildLinkTransactionFromTap({ tap, recipient, feePayer, blockhash }),
		expectationFromTap(tap, ctx.address)
	]);
	const expectation = { ...tapExpectation, feePayer: ctx.feePayer };
	validateLinkTransaction(wireBytes, expectation);

	onPhase('approve');
	const outcome = await signWithWallet(ctx, wireBytes);
	let signature: string;
	if (outcome.kind === 'signed') {
		// Revibase Passkey never returns the transaction: its fee payer checks and submits it.
		validateLinkTransaction(outcome.signedBytes, expectation, { allowWalletAdditions: true });
		const signed = getTransactionDecoder().decode(outcome.signedBytes);
		if (!signed.signatures[feePayer]) throw new LinkTransactionRejected('wallet did not sign');
		signature = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} else {
		signature = getBase58Decoder().decode(outcome.signature);
	}

	onPhase('confirming');
	await waitForConfirmation(signature);
	forgetWalletAccessories();
	return signature;
}

export async function releaseAccessory(ctx: SigningContext, pda: string): Promise<string> {
	const rpc = browserRpc();
	const signer = createNoopSigner(address(ctx.address));
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(address(ctx.feePayer), m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => setTransactionMessageConfig(LINK_TX_CONFIG, m),
		(m) =>
			appendTransactionMessageInstructions(
				[getRemoveOwnerInstruction({ owner: signer, phygitalToken: address(pda) })],
				m
			)
	);
	const wireBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
	const outcome = await signWithWallet(ctx, wireBytes);

	let signature: string;
	if (outcome.kind === 'signed') {
		const signed = getTransactionDecoder().decode(outcome.signedBytes);
		assertReleaseIntact(outcome.signedBytes, pda, ctx);
		signature = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} else {
		signature = getBase58Decoder().decode(outcome.signature);
	}
	await waitForConfirmation(signature);
	forgetWalletAccessories();
	return signature;
}

function assertReleaseIntact(bytes: Uint8Array, pda: string, ctx: SigningContext) {
	const owner = ctx.address;
	let message;
	try {
		message = decodeMessage(bytes);
	} catch {
		throw new LinkTransactionRejected('undecodable release');
	}
	if (message.feePayer !== ctx.feePayer) throw new LinkTransactionRejected('unexpected fee payer');
	const removes = message.instructions.filter(
		(ix) =>
			ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS &&
			bytesEqual(
				new Uint8Array(ix.data ?? []).subarray(0, 8),
				new Uint8Array(REMOVE_OWNER_DISCRIMINATOR)
			)
	);
	const accounts = removes[0]?.accounts ?? [];
	if (
		removes.length !== 1 ||
		accounts.length !== 2 ||
		accounts[0]?.address !== owner ||
		accounts[1]?.address !== pda
	) {
		throw new LinkTransactionRejected('release instruction altered');
	}
	for (const ix of message.instructions) {
		for (const meta of ix.accounts ?? []) {
			const signer =
				meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER;
			if (signer && meta.address !== owner)
				throw new LinkTransactionRejected('unexpected additional signer');
		}
	}
}
