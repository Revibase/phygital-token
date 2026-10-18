export const BRIDGE_VERSION = 1;
export const BRIDGE_SOURCE_DAPP = 'iframe-wallet-dapp';
export const BRIDGE_SOURCE_SHELL = 'iframe-wallet-shell';
const CHAIN = /^solana:[a-z0-9-]+$/;

const REQUESTS = new Set(['connect', 'signTransaction', 'signMessage', 'signAndSendTransaction']);

export type BridgeRequest = {
	id: string;
	method: 'connect' | 'signTransaction' | 'signMessage' | 'signAndSendTransaction';
	payload: unknown;
};

export function embedFrameOrigin(href: string, selfOrigin: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
	if (url.username || url.password || url.origin === selfOrigin) return null;
	return url.origin;
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
