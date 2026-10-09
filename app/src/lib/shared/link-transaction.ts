import {
	AccountRole,
	address,
	appendTransactionMessageInstructions,
	compileTransaction,
	createTransactionMessage,
	decompileTransactionMessage,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Blockhash,
	type Rpc,
	type SolanaRpcApi,
	type TransactionSigner
} from '@solana/kit';
import {
	COMPUTE_BUDGET_PROGRAM_ADDRESS,
	getSetComputeUnitLimitInstruction,
	getSetComputeUnitPriceInstruction
} from '@solana-program/compute-budget';
import {
	completeTransfer,
	getSetOwnerInstructionDataDecoder,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	SET_OWNER_DISCRIMINATOR,
	type TransferSession
} from 'phygital-token-sdk';

import { base64ToBytes, base64UrlToBytes, bytesEqual } from './encoding';
import type { TransferChallenge, TransferPayload } from './types';

export const SECP256R1_PROGRAM_ADDRESS = address('Secp256r1SigVerify1111111111111111111111111');
export const SLOT_HASHES_SYSVAR = address('SysvarS1otHashes111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
/** Wallet guard program (Phantom and others wrap what they sign with its assertions). */
export const LIGHTHOUSE_PROGRAM_ADDRESS = address('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');

/** set_owner is cheap; the secp256r1 precompile is charged per signature, not per CU. */
export const LINK_COMPUTE_UNIT_LIMIT = 60_000;
export const LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50_000n;

export function toTransferSession(fields: TransferChallenge, rpc: Rpc<SolanaRpcApi>): TransferSession {
	return {
		rpc,
		phygitalToken: address(fields.phygitalToken),
		secp256r1Pubkey: fields.secp256r1Pubkey,
		slotHash: base64ToBytes(fields.slotHash),
		slotNumber: BigInt(fields.slotNumber),
		challenge: base64UrlToBytes(fields.challenge),
		rpId: fields.rpId
	};
}

export async function buildLinkTransaction(input: {
	payload: TransferPayload;
	rpc: Rpc<SolanaRpcApi>;
	recipient: TransactionSigner;
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}) {
	const session = toTransferSession(input.payload, input.rpc);
	// TransferPayload['response'] is structurally the SDK's AuthenticationResponseJSON.
	const response = input.payload.response as Parameters<typeof completeTransfer>[1];
	const instructions = await completeTransfer(session, response, input.recipient);

	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayer(input.recipient.address, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(input.blockhash, m),
		(m) =>
			appendTransactionMessageInstructions(
				[
					getSetComputeUnitLimitInstruction({ units: LINK_COMPUTE_UNIT_LIMIT }),
					getSetComputeUnitPriceInstruction({ microLamports: LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS }),
					...instructions
				],
				m
			)
	);
	const transaction = compileTransaction(message);
	return { transaction, wireBytes: new Uint8Array(getTransactionEncoder().encode(transaction)) };
}

export type LinkExpectation = {
	phygitalToken: string;
	recipient: string;
	secp256r1Pubkey: Uint8Array;
	slotNumber: bigint;
	clientDataJson: Uint8Array;
};

export class LinkTransactionRejected extends Error {
	constructor(reason: string) {
		super(`Transaction rejected: ${reason}`);
		this.name = 'LinkTransactionRejected';
	}
}

/**
 * Defense in depth before a wallet signs (and after, on what it returns):
 * decode the exact wire bytes and require that they do nothing except link
 * THIS accessory to THIS wallet with THIS tap. Throws `LinkTransactionRejected`.
 *
 * `allowWalletAdditions` is for re-checking what a wallet returns after
 * signing: the wallet may append instructions after ours, signed only by the
 * user's own key.
 */
export function validateLinkTransaction(
	wireBytes: Uint8Array,
	expected: LinkExpectation,
	options: { allowWalletAdditions?: boolean } = {}
): void {
	const reject = (reason: string): never => {
		throw new LinkTransactionRejected(reason);
	};

	let message;
	try {
		const tx = getTransactionDecoder().decode(wireBytes);
		const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
		if ('addressTableLookups' in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) {
			reject('address lookup tables are not allowed');
		}
		message = decompileTransactionMessage(compiled);
	} catch (err) {
		if (err instanceof LinkTransactionRejected) throw err;
		return reject('undecodable transaction');
	}

	if (message.feePayer.address !== expected.recipient) reject('fee payer is not the linking wallet');

	const ixs = message.instructions;
	let budget = 0;
	let secpIndex = -1;
	let linkIndex = -1;
	ixs.forEach((ix, i) => {
		if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) budget++;
		else if (ix.programAddress === SECP256R1_PROGRAM_ADDRESS) secpIndex = secpIndex === -1 ? i : reject('multiple secp256r1 instructions');
		else if (ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS) linkIndex = linkIndex === -1 ? i : reject('multiple phygital instructions');
		else if (options.allowWalletAdditions && ix.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS) return;
		else if (!(options.allowWalletAdditions && linkIndex !== -1)) reject(`unexpected program ${ix.programAddress}`);
	});
	// On the signed copy a wallet may add compute-budget and Lighthouse guard
	// instructions anywhere (Lighthouse often wraps the whole message); any other
	// program is tolerated only after set_owner. Never an additional
	// signer (checked below).
	if (budget > 2 && !options.allowWalletAdditions) reject('too many compute budget instructions');
	if (linkIndex === -1 || secpIndex !== linkIndex - 1) {
		reject('secp256r1_verify must immediately precede set_owner');
	}

	// set_owner: discriminator, accounts, args.
	const link = ixs[linkIndex];
	const data = new Uint8Array(link.data ?? []);
	if (!bytesEqual(data.subarray(0, 8), new Uint8Array(SET_OWNER_DISCRIMINATOR))) {
		reject('not a set_owner instruction');
	}
	const accounts = link.accounts ?? [];
	const expectAccount = (i: number, addr: Address | string, roles: AccountRole[], what: string) => {
		const meta = accounts[i];
		if (!meta || meta.address !== addr || !roles.includes(meta.role)) reject(`unexpected ${what} account`);
	};
	if (accounts.length !== 4) reject('unexpected account list');
	expectAccount(0, expected.recipient, [AccountRole.READONLY_SIGNER, AccountRole.WRITABLE_SIGNER], 'recipient');
	expectAccount(1, expected.phygitalToken, [AccountRole.WRITABLE], 'phygital token');
	expectAccount(2, SLOT_HASHES_SYSVAR, [AccountRole.READONLY], 'slot hashes');
	expectAccount(3, INSTRUCTIONS_SYSVAR, [AccountRole.READONLY], 'instructions sysvar');

	const args = getSetOwnerInstructionDataDecoder().decode(data);
	if (args.slotNumber !== expected.slotNumber) reject('slot number mismatch');
	if (args.secp256r1VerifyArgs.verifyArgsRelativeIndex !== -1n) reject('unexpected verify index');
	if (!bytesEqual(new Uint8Array(args.secp256r1VerifyArgs.clientDataJson), expected.clientDataJson)) {
		reject('tap data mismatch');
	}

	// secp256r1_verify: exactly one signature, over the accessory's passkey.
	const secp = new Uint8Array(ixs[secpIndex].data ?? []);
	if (secp.length < 16 || secp[0] !== 1) reject('unexpected secp256r1 layout');
	const view = new DataView(secp.buffer, secp.byteOffset, secp.byteLength);
	const pkOffset = view.getUint16(2 + 4, true);
	const pkIxIndex = view.getUint16(2 + 6, true);
	if (pkIxIndex !== 0xffff) reject('secp256r1 key must be inline');
	if (!bytesEqual(secp.subarray(pkOffset, pkOffset + 33), expected.secp256r1Pubkey)) {
		reject('tap is from a different accessory');
	}

	// Only the recipient signs.
	const signers = new Set<string>([message.feePayer.address]);
	for (const ix of ixs) {
		for (const meta of ix.accounts ?? []) {
			if (meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER) signers.add(meta.address);
		}
	}
	if (signers.size !== 1) reject('unexpected additional signer');
}

export function expectationFromPayload(payload: TransferPayload, recipient: string): LinkExpectation {
	return {
		phygitalToken: payload.phygitalToken,
		recipient,
		secp256r1Pubkey: base64UrlToBytes(payload.secp256r1Pubkey),
		slotNumber: BigInt(payload.slotNumber),
		clientDataJson: base64UrlToBytes(payload.response.response.clientDataJSON)
	};
}
