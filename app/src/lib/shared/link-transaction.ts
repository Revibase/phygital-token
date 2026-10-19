import {
	AccountRole,
	appendTransactionMessageInstructions,
	compileTransaction,
	createTransactionMessage,
	getTransactionEncoder,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Address,
	type Blockhash,
	type Instruction,
	type TransactionSigner
} from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import {
	completeTransfer,
	getSetOwnerInstructionDataDecoder,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	SET_OWNER_DISCRIMINATOR,
	type AuthenticationResponseJSON,
	type TransferSession
} from 'phygital-token-sdk';

import { base64UrlToBytes, bytesEqual } from './encoding';
import {
	INSTRUCTIONS_SYSVAR,
	LIGHTHOUSE_PROGRAM_ADDRESS,
	SECP256R1_PROGRAM_ADDRESS,
	SLOT_HASHES_SYSVAR
} from './addresses';
import { LINK_TX_CONFIG } from './fee-policy';
import {
	decodeMessage,
	PasskeyTransactionRejected,
	type DecodedMessage
} from './passkey-transaction';

/**
 * How long a tap over a freshly fetched slot hash stays usable.
 *
 * `set_owner` looks the slot up in SlotHashes (512 entries) at execution, so
 * the hash survives 511 more blocks; we stop 20 blocks early so a signature made at
 * the last second can still land. Real slots run slower than the 200 ms assumed here
 * and skipped slots don't use up entries, so this is conservative. It only drives the
 * countdown — the program is the final authority.
 */
export const TAP_WINDOW_MS = (511 - 20) * 200;

export type LinkTap = { session: TransferSession; response: AuthenticationResponseJSON };

/** The WebAuthn proof is collected in the browser; no server-issued challenge payload is used. */
export async function buildLinkTransactionFromTap(input: {
	tap: LinkTap;
	recipient: TransactionSigner;
	/** Who pays the fee: the recipient, unless it is a passkey vault (a Revibase fee payer). */
	feePayer?: Address;
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}) {
	const instructions = await completeTransfer(
		input.tap.session,
		input.tap.response,
		input.recipient
	);
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(input.feePayer ?? input.recipient.address, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(input.blockhash, m),
		(m) => setTransactionMessageConfig(LINK_TX_CONFIG, m),
		(m) => appendTransactionMessageInstructions(instructions, m)
	);
	const transaction = compileTransaction(message);
	return { transaction, wireBytes: new Uint8Array(getTransactionEncoder().encode(transaction)) };
}

export type LinkExpectation = {
	phygitalToken: string;
	recipient: string;
	/** Defaults to the recipient. */
	feePayer?: string;
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
	validateLinkMessage(decodeLinkMessage(wireBytes), expected, options);
}

function decodeLinkMessage(wireBytes: Uint8Array): DecodedMessage {
	try {
		return decodeMessage(wireBytes);
	} catch (err) {
		if (err instanceof PasskeyTransactionRejected) throw new LinkTransactionRejected(err.reason);
		throw err;
	}
}

function validateLinkMessage(
	message: { feePayer: Address; instructions: readonly Instruction[] },
	expected: LinkExpectation,
	options: { allowWalletAdditions?: boolean } = {}
): void {
	const reject = (reason: string): never => {
		throw new LinkTransactionRejected(reason);
	};

	if (message.feePayer !== (expected.feePayer ?? expected.recipient))
		reject('fee payer is not the linking wallet');

	const ixs = message.instructions;
	let budget = 0;
	let secpIndex = -1;
	let linkIndex = -1;
	ixs.forEach((ix, i) => {
		if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) budget++;
		else if (ix.programAddress === SECP256R1_PROGRAM_ADDRESS)
			secpIndex = secpIndex === -1 ? i : reject('multiple secp256r1 instructions');
		else if (ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS)
			linkIndex = linkIndex === -1 ? i : reject('multiple phygital instructions');
		else if (options.allowWalletAdditions && ix.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS)
			return;
		else if (!(options.allowWalletAdditions && linkIndex !== -1))
			reject(`unexpected program ${ix.programAddress}`);
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
		if (!meta || meta.address !== addr || !roles.includes(meta.role))
			reject(`unexpected ${what} account`);
	};
	if (accounts.length !== 4) reject('unexpected account list');
	expectAccount(
		0,
		expected.recipient,
		[AccountRole.READONLY_SIGNER, AccountRole.WRITABLE_SIGNER],
		'recipient'
	);
	expectAccount(1, expected.phygitalToken, [AccountRole.WRITABLE], 'phygital token');
	expectAccount(2, SLOT_HASHES_SYSVAR, [AccountRole.READONLY], 'slot hashes');
	expectAccount(3, INSTRUCTIONS_SYSVAR, [AccountRole.READONLY], 'instructions sysvar');

	const args = getSetOwnerInstructionDataDecoder().decode(data);
	if (args.slotNumber !== expected.slotNumber) reject('slot number mismatch');
	if (args.secp256r1VerifyArgs.verifyArgsRelativeIndex !== -1n) reject('unexpected verify index');
	if (
		!bytesEqual(new Uint8Array(args.secp256r1VerifyArgs.clientDataJson), expected.clientDataJson)
	) {
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
	for (const ix of ixs) {
		for (const meta of ix.accounts ?? []) {
			const signs =
				meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER;
			if (signs && meta.address !== expected.recipient) reject('unexpected additional signer');
		}
	}
}

export async function expectationFromTap(
	tap: LinkTap,
	recipient: string
): Promise<LinkExpectation> {
	return {
		phygitalToken: tap.session.phygitalToken,
		recipient,
		secp256r1Pubkey: base64UrlToBytes(tap.session.secp256r1Pubkey),
		slotNumber: tap.session.slotNumber,
		clientDataJson: base64UrlToBytes(tap.response.response.clientDataJSON)
	};
}

/** Compatibility expectation for the local API-driven end-to-end harness. */
