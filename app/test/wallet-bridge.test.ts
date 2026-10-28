import { describe, expect, it, vi } from 'vitest';
import {
	connectWhenReady,
	startEmbedHost,
	type EmbedAccount,
	type EmbedSigner
} from '#lib/client/wallet/embed-host.ts';
import {
	BRIDGE_SOURCE_DAPP,
	BRIDGE_SOURCE_SHELL,
	BRIDGE_VERSION,
	embedFrameOrigin,
	readDappRequest,
	transactionBytes
} from '#lib/shared/wallet-bridge.ts';

const ZEROS = new Uint8Array(32);

describe('embed frame origin', () => {
	it('allows another https origin, loopback only from loopback, and refuses itself', () => {
		expect(embedFrameOrigin('https://shop.example.com/app', 'https://portal.revibase.com')).toBe(
			'https://shop.example.com'
		);
		expect(embedFrameOrigin('http://localhost:5174', 'http://localhost:5173')).toBe(
			'http://localhost:5174'
		);
		expect(
			embedFrameOrigin('https://portal.revibase.com/x', 'https://portal.revibase.com')
		).toBeNull();
		expect(embedFrameOrigin('http://localhost:5174', 'https://portal.revibase.com')).toBeNull();
		expect(embedFrameOrigin('http://evil.test', 'https://portal.revibase.com')).toBeNull();
		expect(embedFrameOrigin('javascript:alert(1)', 'https://portal.revibase.com')).toBeNull();
	});
});

describe('embed host', () => {
	const account: EmbedAccount = {
		address: 'Owner111111111111111111111111111111111111',
		publicKey: ZEROS,
		chain: 'solana:devnet'
	};

	it('rejects a different origin and accepts a transaction of any length', () => {
		expect(readDappRequest({ source: 'other', version: 1, id: 'a', method: 'connect' })).toBeNull();
		expect(transactionBytes({ transaction: new Uint8Array(0), chain: 'solana:devnet' })).toBeNull();
		expect(
			transactionBytes({ transaction: new Uint8Array(2000), chain: 'solana:devnet' })?.bytes
				.byteLength
		).toBe(2000);
		expect(
			transactionBytes({ transaction: new Uint8Array([1]), chain: 'solana:devnet' })?.chain
		).toBe('solana:devnet');
	});

	it('asks once, then signs on the parent cluster only', async () => {
		const contentWindow = { postMessage: vi.fn() };
		const listeners = new Set<
			(event: { source: unknown; origin: string; data: unknown }) => void
		>();
		const current = account;
		const signer: EmbedSigner = {
			account: () => current,
			signTransaction: vi.fn(async (bytes: Uint8Array) => bytes),
			signMessage: vi.fn(async () => new Uint8Array([1])),
			signAndSendTransaction: vi.fn(async () => new Uint8Array([2]))
		};
		const approve = vi.fn(async () => true);
		startEmbedHost({
			target: {
				addEventListener: (
					_t: string,
					fn: (event: { source: unknown; origin: string; data: unknown }) => void
				) => listeners.add(fn),
				removeEventListener: () => {}
			} as unknown as EventTarget,
			iframe: { contentWindow },
			expectedOrigin: 'https://pay.test',
			approve,
			signer,
			storage: { getItem: () => null, setItem: () => {} }
		});
		const deliver = (
			data: unknown,
			origin = 'https://pay.test',
			source: unknown = contentWindow
		) => {
			for (const fn of listeners) fn({ source, origin, data });
		};
		deliver({
			source: BRIDGE_SOURCE_DAPP,
			version: BRIDGE_VERSION,
			id: 'c1',
			method: 'connect'
		});
		await vi.waitFor(() => expect(approve).toHaveBeenCalledWith('https://pay.test'));
		deliver(
			{ source: BRIDGE_SOURCE_DAPP, version: BRIDGE_VERSION, id: 'nope', method: 'connect' },
			'https://evil.test'
		);
		expect(contentWindow.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ id: 'nope' }),
			expect.anything()
		);
		deliver({
			source: BRIDGE_SOURCE_DAPP,
			version: BRIDGE_VERSION,
			id: 's1',
			method: 'signTransaction',
			payload: { transaction: new Uint8Array([9]), chain: 'solana:mainnet' }
		});
		await vi.waitFor(() =>
			expect(contentWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ id: 's1', ok: false }),
				'https://pay.test'
			)
		);
		expect(signer.signTransaction).not.toHaveBeenCalled();
	});

	it('asks the shell to connect a wallet before approving a connect', async () => {
		const contentWindow = { postMessage: vi.fn() };
		let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null =
			null;
		let current: EmbedAccount | null = null;
		const connect = vi.fn(async () => {
			current = account;
			return true;
		});
		const approve = vi.fn(async () => true);
		startEmbedHost({
			target: {
				addEventListener: (_t: string, fn: typeof listener) => (listener = fn),
				removeEventListener: () => {}
			} as unknown as EventTarget,
			iframe: { contentWindow },
			expectedOrigin: 'https://pay.test',
			approve,
			connect,
			signer: {
				account: () => current,
				signTransaction: async (bytes) => bytes,
				signMessage: async () => new Uint8Array([1]),
				signAndSendTransaction: async () => new Uint8Array([2])
			},
			storage: { getItem: () => null, setItem: () => {} }
		});
		listener!({
			source: contentWindow,
			origin: 'https://pay.test',
			data: { source: BRIDGE_SOURCE_DAPP, version: BRIDGE_VERSION, id: 'c1', method: 'connect' }
		});
		await vi.waitFor(() =>
			expect(contentWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'c1', ok: true }),
				'https://pay.test'
			)
		);
		expect(connect).toHaveBeenCalledOnce();
		expect(approve).toHaveBeenCalledWith('https://pay.test');
	});

	it('refuses a connect when the shell connects no wallet', async () => {
		const contentWindow = { postMessage: vi.fn() };
		let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null =
			null;
		const approve = vi.fn(async () => true);
		startEmbedHost({
			target: {
				addEventListener: (_t: string, fn: typeof listener) => (listener = fn),
				removeEventListener: () => {}
			} as unknown as EventTarget,
			iframe: { contentWindow },
			expectedOrigin: 'https://pay.test',
			approve,
			connect: async () => false,
			signer: {
				account: () => null,
				signTransaction: async (bytes) => bytes,
				signMessage: async () => new Uint8Array([1]),
				signAndSendTransaction: async () => new Uint8Array([2])
			},
			storage: { getItem: () => null, setItem: () => {} }
		});
		listener!({
			source: contentWindow,
			origin: 'https://pay.test',
			data: { source: BRIDGE_SOURCE_DAPP, version: BRIDGE_VERSION, id: 'c1', method: 'connect' }
		});
		await vi.waitFor(() =>
			expect(contentWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'c1', ok: false }),
				'https://pay.test'
			)
		);
		expect(approve).not.toHaveBeenCalled();
	});

	function frameHost(approved: boolean) {
		const contentWindow = { postMessage: vi.fn() };
		let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null =
			null;
		const approve = vi.fn(async () => true);
		const connect = vi.fn(async () => true);
		startEmbedHost({
			target: {
				addEventListener: (_t: string, fn: typeof listener) => (listener = fn),
				removeEventListener: () => {}
			} as unknown as EventTarget,
			iframe: { contentWindow },
			expectedOrigin: 'https://pay.test',
			approve,
			connect,
			signer: {
				account: () => account,
				signTransaction: async (bytes) => bytes,
				signMessage: async () => new Uint8Array([1]),
				signAndSendTransaction: async () => new Uint8Array([2])
			},
			storage: {
				getItem: () => (approved ? JSON.stringify({ 'https://pay.test': account.address }) : null),
				setItem: () => {}
			}
		});
		const send = (id: string, method: string, payload?: unknown) =>
			listener!({
				source: contentWindow,
				origin: 'https://pay.test',
				data: { source: BRIDGE_SOURCE_DAPP, version: BRIDGE_VERSION, id, method, payload }
			});
		return { contentWindow, approve, send };
	}

	it('answers ready with hello, and shares the account only once the site is approved', () => {
		for (const approved of [false, true]) {
			const { contentWindow, send } = frameHost(approved);
			send('r1', 'ready');
			expect(contentWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					source: BRIDGE_SOURCE_SHELL,
					version: BRIDGE_VERSION,
					method: 'hello'
				}),
				'https://pay.test'
			);
			const accounts = approved
				? [{ address: account.address, publicKey: account.publicKey, chains: [account.chain] }]
				: [];
			expect(contentWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ method: 'accountsChanged', payload: { accounts } }),
				'https://pay.test'
			);
		}
	});

	it('reconnects silently only when the site is already approved, and never prompts', async () => {
		for (const approved of [false, true]) {
			const { contentWindow, approve, send } = frameHost(approved);
			send('s1', 'connect', { silent: true });
			await vi.waitFor(() =>
				expect(contentWindow.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({ id: 's1', ok: approved }),
					'https://pay.test'
				)
			);
			expect(approve).not.toHaveBeenCalled();
		}
	});

	it('uses a session that finishes restoring instead of asking to sign in again', async () => {
		let restored: () => void = () => {};
		let current: EmbedAccount | null = null;
		const choose = vi.fn(async () => true);
		const connecting = connectWhenReady({
			ready: () => new Promise<void>((resolve) => (restored = resolve)),
			account: () => current,
			choose
		});
		current = account;
		restored();
		await expect(connecting).resolves.toBe(true);
		expect(choose).not.toHaveBeenCalled();
	});

	it('asks to choose a wallet only when none is signed in once restored', async () => {
		const choose = vi.fn(async () => false);
		await expect(
			connectWhenReady({ ready: async () => {}, account: () => null, choose })
		).resolves.toBe(false);
		expect(choose).toHaveBeenCalledOnce();
	});
});
