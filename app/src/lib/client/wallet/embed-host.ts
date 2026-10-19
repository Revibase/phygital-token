import {
	BRIDGE_SOURCE_SHELL,
	BRIDGE_VERSION,
	embedFrameOrigin,
	messageBytes,
	readDappRequest,
	transactionBytes,
	type BridgeRequest
} from '#lib/shared/wallet-bridge.ts';

const APPROVALS = 'revibase:embed-approval';

export type EmbedAccount = {
	address: string;
	publicKey: Uint8Array;
	chain: string;
};

export type EmbedSigner = {
	account: () => EmbedAccount | null;
	signTransaction: (bytes: Uint8Array, chain: string) => Promise<Uint8Array>;
	signMessage: (bytes: Uint8Array, chain: string) => Promise<Uint8Array>;
	signAndSendTransaction: (bytes: Uint8Array, chain: string) => Promise<Uint8Array>;
};

export type EmbedHost = {
	stop: () => void;
	hello: () => void;
	pushAccounts: (accounts: EmbedAccount[]) => void;
};

export function startEmbedHost(input: {
	target: EventTarget;
	iframe: { contentWindow: { postMessage: (message: unknown, origin: string) => void } | null };
	expectedOrigin: string;
	walletName?: string;
	approve: (origin: string) => Promise<boolean>;
	/** Asks the shell to connect a wallet when none is; resolves true once one is. */
	connect?: () => Promise<boolean>;
	signer: EmbedSigner;
	storage?: Pick<Storage, 'getItem' | 'setItem'>;
}): EmbedHost {
	const storage = input.storage ?? window.localStorage;
	const seen = new Set<string>();
	let stopped = false;

	function post(message: Record<string, unknown>) {
		if (stopped) return;
		input.iframe.contentWindow?.postMessage(
			{ source: BRIDGE_SOURCE_SHELL, version: BRIDGE_VERSION, ...message },
			input.expectedOrigin
		);
	}

	function hello() {
		post({
			id: 'hello',
			method: 'hello',
			payload: { name: input.walletName ?? 'Revibase' }
		});
	}

	function pushAccounts(accounts: EmbedAccount[]) {
		post({
			id: 'accounts',
			method: 'accountsChanged',
			payload: {
				accounts: accounts.map((account) => ({
					address: account.address,
					publicKey: account.publicKey,
					chains: [account.chain]
				}))
			}
		});
	}

	async function handle(request: BridgeRequest) {
		if (request.method === 'connect') {
			let account = input.signer.account();
			if (!account && (await input.connect?.())) account = input.signer.account();
			if (!account) throw new Error('Connect a wallet in Revibase first.');
			if (!remembered(storage, input.expectedOrigin, account.address)) {
				const ok = await input.approve(input.expectedOrigin);
				if (!ok) throw new Error('Connection cancelled.');
				remember(storage, input.expectedOrigin, account.address);
			}
			const current = input.signer.account();
			if (!current || current.address !== account.address)
				throw new Error('Connect a wallet in Revibase first.');
			return {
				address: current.address,
				publicKey: current.publicKey,
				chains: [current.chain]
			};
		}
		const parsed =
			request.method === 'signMessage'
				? messageBytes(request.payload)
				: transactionBytes(request.payload);
		if (!parsed) throw new Error('Revibase could not read that request.');
		const account = input.signer.account();
		if (!account) throw new Error('Connect a wallet in Revibase first.');
		if (parsed.chain !== account.chain)
			throw new Error('This app asked for a different Solana network.');
		if (request.method === 'signMessage') {
			return { signature: await input.signer.signMessage(parsed.bytes, parsed.chain) };
		}
		if (request.method === 'signAndSendTransaction') {
			return { signature: await input.signer.signAndSendTransaction(parsed.bytes, parsed.chain) };
		}
		return { signedTransaction: await input.signer.signTransaction(parsed.bytes, parsed.chain) };
	}

	async function onMessage(event: Event) {
		const message = event as MessageEvent;
		if (message.source !== input.iframe.contentWindow) return;
		if (message.origin !== input.expectedOrigin) return;
		const request = readDappRequest(message.data);
		if (!request || seen.has(request.id)) return;
		seen.add(request.id);
		try {
			post({ id: request.id, ok: true, payload: await handle(request) });
		} catch (err) {
			post({
				id: request.id,
				ok: false,
				error:
					err instanceof Error && err.message ? err.message : 'Revibase could not complete that.'
			});
		}
	}

	const listener = (event: Event) => void onMessage(event);
	input.target.addEventListener('message', listener);
	return {
		stop: () => {
			stopped = true;
			input.target.removeEventListener('message', listener);
		},
		hello,
		pushAccounts
	};
}

export { embedFrameOrigin };

function remembered(storage: Pick<Storage, 'getItem'>, origin: string, address: string): boolean {
	try {
		const parsed = JSON.parse(storage.getItem(APPROVALS) ?? '{}') as Record<string, unknown>;
		return parsed[origin] === address;
	} catch {
		return false;
	}
}

function remember(storage: Pick<Storage, 'getItem' | 'setItem'>, origin: string, address: string) {
	let parsed: Record<string, unknown> = {};
	try {
		const raw = JSON.parse(storage.getItem(APPROVALS) ?? '{}') as unknown;
		if (raw && typeof raw === 'object') parsed = raw as Record<string, unknown>;
	} catch {
		parsed = {};
	}
	parsed[origin] = address;
	storage.setItem(APPROVALS, JSON.stringify(parsed));
}
