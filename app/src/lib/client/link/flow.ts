import {
	AccountRole,
	address,
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	decompileTransactionMessage,
	getBase58Decoder,
	getCompiledTransactionMessageDecoder,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash
} from '@solana/kit';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import {
	authenticatePasskeyForTransfer,
	getRemoveOwnerInstruction,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	REMOVE_OWNER_DISCRIMINATOR
} from 'phygital-token-sdk';

import { bytesEqual } from '$lib/shared/encoding';
import { LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS } from '$lib/shared/fee-policy';
import {
	buildLinkTransaction,
	expectationFromPayload,
	LinkTransactionRejected,
	toTransferSession,
	validateLinkTransaction
} from '$lib/shared/link-transaction';
import type { LinkStatusView, TransferChallenge, TransferPayload } from '$lib/shared/types';
import { getJson, postJson } from '../api';
import { browserRpc } from '../rpc';
import { forgetWalletAccessories } from '../cache';
import { waitForConfirmation } from '../tx';
import { signWithWallet, type SigningContext } from '../wallet/wallet.svelte';

/** Creates the ceremony and returns its first slot-bound challenge in one round trip. */
export function startPhoneLink(): Promise<LinkStatusView & { challenge: TransferChallenge }> {
	return postJson('/api/link');
}

/**
 * Prefetch before the click: iOS WebAuthn requires a user gesture without a network await.
 */
export function prepareTap(linkId: string): Promise<TransferChallenge> {
	return postJson<TransferChallenge>(`/api/link/${linkId}/challenge`);
}

export async function tapWithChallenge(fields: TransferChallenge, opts: { finishHere: boolean }) {
	const session = toTransferSession(fields, browserRpc());
	const response = await authenticatePasskeyForTransfer(session);
	return postJson<{ status: LinkStatusView; handoffUrl: string | null }>(
		`/api/link/${fields.linkId}/assertion`,
		{
			response,
			finishHere: opts.finishHere
		}
	);
}

export function claimHandoff(h: string): Promise<LinkStatusView> {
	return postJson('/api/handoff/claim', { h });
}

export function linkStatus(linkId: string): Promise<LinkStatusView> {
	return getJson(`/api/link/${linkId}`);
}

export function cancelLink(linkId: string): Promise<LinkStatusView> {
	return postJson(`/api/link/${linkId}/cancel`);
}

export async function pollLink(
	linkId: string,
	onUpdate: (s: LinkStatusView) => boolean | void,
	signal: AbortSignal,
	intervalMs = 1500
) {
	while (!signal.aborted) {
		try {
			if (onUpdate(await linkStatus(linkId)) === true) return;
		} catch {
			// Transient: keep polling until aborted.
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

export type FinishPhase = 'preparing' | 'approve' | 'confirming';

export async function finishInWallet(
	linkId: string,
	ctx: SigningContext,
	onPhase: (p: FinishPhase) => void = () => {}
): Promise<LinkStatusView> {
	onPhase('preparing');
	const { payload } = await postJson<{ payload: TransferPayload }>(
		`/api/link/${linkId}/recipient`,
		{
			address: ctx.address
		}
	);

	const rpc = browserRpc();
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const { wireBytes } = await buildLinkTransaction({
		payload,
		rpc,
		recipient: createNoopSigner(address(ctx.address)),
		blockhash
	});
	const expectation = expectationFromPayload(payload, ctx.address);
	validateLinkTransaction(wireBytes, expectation);

	onPhase('approve');
	const outcome = await signWithWallet(ctx, wireBytes);

	let sig: string;
	if (outcome.kind === 'signed') {
		validateLinkTransaction(outcome.signedBytes, expectation, { allowWalletAdditions: true });
		const signed = getTransactionDecoder().decode(outcome.signedBytes);
		if (!signed.signatures[address(ctx.address)])
			throw new LinkTransactionRejected('wallet did not sign');
		sig = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} else {
		sig = getBase58Decoder().decode(outcome.signature);
	}

	onPhase('confirming');
	return postJson<LinkStatusView>(`/api/link/${linkId}/submitted`, {
		signature: sig,
		app: ctx.wallet.name
	});
}

export async function releaseAccessory(ctx: SigningContext, pda: string): Promise<string> {
	const rpc = browserRpc();
	const signer = createNoopSigner(address(ctx.address));
	const blockhash = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayer(signer.address, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) =>
			appendTransactionMessageInstructions(
				[
					getSetComputeUnitPriceInstruction({
						microLamports: LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS
					}),
					getRemoveOwnerInstruction({ owner: signer, phygitalToken: address(pda) })
				],
				m
			)
	);
	const wireBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
	const outcome = await signWithWallet(ctx, wireBytes);

	let sig: string;
	if (outcome.kind === 'signed') {
		const signed = getTransactionDecoder().decode(outcome.signedBytes);
		assertReleaseIntact(outcome.signedBytes, pda, ctx.address);
		sig = await rpc
			.sendTransaction(getBase64EncodedWireTransaction(signed), {
				encoding: 'base64',
				preflightCommitment: 'confirmed'
			})
			.send();
	} else {
		sig = getBase58Decoder().decode(outcome.signature);
	}
	await waitForConfirmation(sig);
	// The wallet's accessory list is now wrong: drop it so no stale list flashes.
	forgetWalletAccessories();
	return sig;
}

function assertReleaseIntact(bytes: Uint8Array, pda: string, owner: string) {
	let message;
	try {
		const tx = getTransactionDecoder().decode(bytes);
		message = decompileTransactionMessage(
			getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
		);
	} catch {
		throw new LinkTransactionRejected('undecodable release');
	}
	if (message.feePayer.address !== owner) throw new LinkTransactionRejected('unexpected fee payer');
	const removes = message.instructions.filter(
		(ix) =>
			ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS &&
			bytesEqual(
				new Uint8Array(ix.data ?? []).subarray(0, 8),
				new Uint8Array(REMOVE_OWNER_DISCRIMINATOR)
			)
	);
	const accounts = removes[0]?.accounts ?? [];
	if (removes.length !== 1 || accounts[0]?.address !== owner || accounts[1]?.address !== pda) {
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
