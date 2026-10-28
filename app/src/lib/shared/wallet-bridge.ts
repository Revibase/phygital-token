import {
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
	type CompiledTransactionMessage,
	type ReadonlyUint8Array
} from '@solana/kit';
import { PHYGITAL_TOKEN_PROGRAM_ADDRESS, VERIFY_DISCRIMINATOR } from 'phygital-token-sdk';

export const BRIDGE_VERSION = 1;
export const BRIDGE_SOURCE_DAPP = 'iframe-wallet-dapp';
export const BRIDGE_SOURCE_SHELL = 'iframe-wallet-shell';
const CHAIN = /^solana:[a-z0-9-]+$/;

const REQUESTS = new Set([
	'connect',
	'signTransaction',
	'signMessage',
	'signAndSendTransaction',
	'ready'
]);

export type BridgeRequest = {
	id: string;
	method: 'connect' | 'signTransaction' | 'signMessage' | 'signAndSendTransaction' | 'ready';
	payload: unknown;
};

export function embedFrameOrigin(href: string, selfOrigin: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (
		url.protocol !== 'https:' &&
		!(url.protocol === 'http:' && isLoopback(url) && isLoopback(new URL(selfOrigin)))
	)
		return null;
	if (url.username || url.password || url.origin === selfOrigin) return null;
	return url.origin;
}

function isLoopback(url: URL): boolean {
	return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

export function readDappRequest(data: unknown): BridgeRequest | null {
	if (!data || typeof data !== 'object') return null;
	const message = data as Record<string, unknown>;
	if (message.source !== BRIDGE_SOURCE_DAPP || message.version !== BRIDGE_VERSION) return null;
	if (typeof message.id !== 'string' || message.id.length < 1 || message.id.length > 80)
		return null;
	if (typeof message.method !== 'string' || !REQUESTS.has(message.method)) return null;
	return {
		id: message.id,
		method: message.method as BridgeRequest['method'],
		payload: message.payload
	};
}

export function transactionBytes(payload: unknown): { bytes: Uint8Array; chain: string } | null {
	return bytesField(payload, 'transaction');
}

export function messageBytes(payload: unknown): { bytes: Uint8Array; chain: string } | null {
	return bytesField(payload, 'message');
}

function bytesField(
	payload: unknown,
	key: 'transaction' | 'message'
): { bytes: Uint8Array; chain: string } | null {
	if (!payload || typeof payload !== 'object') return null;
	const record = payload as Record<string, unknown>;
	const bytes = record[key];
	const chain = record.chain;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) return null;
	if (typeof chain !== 'string' || !CHAIN.test(chain)) return null;
	return { bytes, chain };
}

/**
 * Why Revibase refuses to sign this message for a framed app, or null if it can ask the person.
 * A framed app may be hostile, so it can't get a signature that works somewhere else:
 * not a transaction passed off as a message, and not a sign-in to another site (such as Revibase itself).
 */
export function refuseMessage(bytes: Uint8Array, frameOrigin: string): string | null {
	if (isTransactionMessage(bytes)) return 'Revibase won’t sign a transaction as a message.';
	const signIn = /^(\S+) wants you to sign in with your Solana account:/.exec(
		new TextDecoder().decode(bytes)
	);
	if (signIn && signIn[1].toLowerCase() !== new URL(frameOrigin).host)
		return `Revibase won’t sign you in to ${signIn[1]} from another site.`;
	return null;
}

/**
 * Why Revibase refuses to sign this transaction for a framed app, or null if it can ask the person.
 * Of the accessory program, a framed app may only call `verify`, never change who owns an accessory.
 */
export function refuseTransaction(bytes: Uint8Array): string | null {
	let calls: { program: string; data: ReadonlyUint8Array }[];
	try {
		calls = programCalls(
			getCompiledTransactionMessageDecoder().decode(
				getTransactionDecoder().decode(bytes).messageBytes
			)
		);
	} catch {
		return 'Revibase could not read that transaction.';
	}
	const ownerChange = calls.some(
		({ program, data }) =>
			program === PHYGITAL_TOKEN_PROGRAM_ADDRESS && !startsWith(data, VERIFY_DISCRIMINATOR)
	);
	return ownerChange ? 'Revibase won’t let another site change your accessories.' : null;
}

function isTransactionMessage(bytes: Uint8Array): boolean {
	try {
		const [, end] = getCompiledTransactionMessageDecoder().read(bytes, 0);
		return end === bytes.length;
	} catch {
		return false;
	}
}

/** Invoked programs are always static accounts, so address lookup tables can't hide one. */
function programCalls(
	message: CompiledTransactionMessage
): { program: string; data: ReadonlyUint8Array }[] {
	if ('instructionHeaders' in message) {
		return message.instructionHeaders.map((header, i) => ({
			program: message.staticAccounts[header.programAccountIndex],
			data: message.instructionPayloads[i].instructionData
		}));
	}
	return message.instructions.map((ix) => ({
		program: message.staticAccounts[ix.programAddressIndex],
		data: ix.data ?? new Uint8Array()
	}));
}

function startsWith(data: ReadonlyUint8Array, prefix: ReadonlyUint8Array): boolean {
	return data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);
}
