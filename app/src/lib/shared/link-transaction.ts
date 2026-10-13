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

export const SECP256R1_PROGRAM_ADDRESS = address('Secp256r1SigVerify1111111111111111111111111');
export const SLOT_HASHES_SYSVAR = address('SysvarS1otHashes111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
/** Wallet guard program (Phantom and others wrap what they sign with its assertions). */
export const LIGHTHOUSE_PROGRAM_ADDRESS = address('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');

/** set_owner is cheap; the secp256r1 precompile is charged per signature, not per CU. */
export const LINK_COMPUTE_UNIT_LIMIT = 60_000;
export const LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50_000n;

/** A compute-unit price over `units`, in lamports, rounded up (as the fee service checks it). */
export function priorityFeeLamports(microLamportsPerUnit: bigint, units: number): bigint {
	return (microLamportsPerUnit * BigInt(units) + 999_999n) / 1_000_000n;
}

/** The v1 message config every app transaction uses, at the app's compute-unit price. */
export function v1MessageConfig(units: number) {
	return {
		computeUnitLimit: units,
		loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
		priorityFeeLamports: priorityFeeLamports(LINK_COMPUTE_UNIT_PRICE_MICROLAMPORTS, units)
	};
}

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

/** An accessory tap over a slot-bound transfer challenge: everything `set_owner` needs but the recipient. */
export type LinkTap = { session: TransferSession; response: AuthenticationResponseJSON };

/** The secp256r1 verify and `set_owner` that link this tap's accessory to `recipient`. */
export function buildLinkInstructions(tap: LinkTap, recipient: TransactionSigner) {
	return completeTransfer(tap.session, tap.response, recipient);
}

export async function buildLinkTransaction(input: {
	tap: LinkTap;
	recipient: TransactionSigner;
	blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}) {
	const instructions = await buildLinkInstructions(input.tap, input.recipient);
	const message = pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayer(input.recipient.address, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(input.blockhash, m),
		(m) => setTransactionMessageConfig(v1MessageConfig(LINK_COMPUTE_UNIT_LIMIT), m),
		(m) => appendTransactionMessageInstructions(instructions, m)
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
	/** Defaults to the recipient; a Revibase fee payer when the recipient can't pay. */
	feePayer?: string;
	/** The prepaid-fee refill, which must come right after `set_owner`, exactly as built. */
	refill?: Instruction;
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

	const feePayer = expected.feePayer ?? expected.recipient;
	if (message.feePayer.address !== feePayer) reject('fee payer is not the linking wallet');

	const ixs = message.instructions;
	let budget = 0;
	let secpIndex = -1;
	let linkIndex = -1;
	let refillIndex = -1;
	ixs.forEach((ix, i) => {
		if (ix.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS) budget++;
		else if (ix.programAddress === SECP256R1_PROGRAM_ADDRESS)
			secpIndex = secpIndex === -1 ? i : reject('multiple secp256r1 instructions');
		else if (
			ix.programAddress === PHYGITAL_TOKEN_PROGRAM_ADDRESS &&
			linkIndex !== -1 &&
			refillIndex === -1 &&
			expected.refill &&
			sameInstruction(ix, expected.refill)
		)
			refillIndex = i;
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
	if (expected.refill && refillIndex === -1) reject('missing the network-fee refill');

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
	if (accounts.length !== 6) reject('unexpected account list');
	expectAccount(
		0,
		expected.recipient,
		[AccountRole.READONLY_SIGNER, AccountRole.WRITABLE_SIGNER],
		'recipient'
	);
	expectAccount(1, expected.phygitalToken, [AccountRole.WRITABLE], 'phygital token');
	expectAccount(2, SLOT_HASHES_SYSVAR, [AccountRole.READONLY], 'slot hashes');
	expectAccount(3, INSTRUCTIONS_SYSVAR, [AccountRole.READONLY], 'instructions sysvar');
	// The program checks the policy's seeds and that the rent receiver is its payer.
	if (accounts[4].role !== AccountRole.WRITABLE) reject('unexpected policy account');
	if (accounts[5].role !== AccountRole.READONLY && accounts[5].role !== AccountRole.WRITABLE) {
		reject('unexpected policy rent receiver account');
	}

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

	// Only the recipient (and its fee payer) sign.
	for (const ix of ixs) {
		for (const meta of ix.accounts ?? []) {
			const signs =
				meta.role === AccountRole.READONLY_SIGNER || meta.role === AccountRole.WRITABLE_SIGNER;
			if (signs && meta.address !== expected.recipient && meta.address !== feePayer)
				reject('unexpected additional signer');
		}
	}
}

/** Same program, data and accounts (roles may differ only by what a wallet's copy elevates). */
export function sameInstruction(a: Instruction, b: Instruction): boolean {
	return (
		a.programAddress === b.programAddress &&
		bytesEqual(new Uint8Array(a.data ?? []), new Uint8Array(b.data ?? [])) &&
		(a.accounts ?? []).length === (b.accounts ?? []).length &&
		(a.accounts ?? []).every((meta, i) => meta.address === b.accounts![i]!.address)
	);
}

export function linkExpectation(tap: LinkTap, recipient: string): LinkExpectation {
	return {
		phygitalToken: tap.session.phygitalToken,
		recipient,
		secp256r1Pubkey: base64UrlToBytes(tap.session.secp256r1Pubkey),
		slotNumber: tap.session.slotNumber,
		clientDataJson: base64UrlToBytes(tap.response.response.clientDataJSON)
	};
}
