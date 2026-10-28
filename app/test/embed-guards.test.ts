import {
	address,
	appendTransactionMessageInstruction,
	compileTransaction,
	createTransactionMessage,
	getTransactionEncoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Blockhash
} from '@solana/kit';
import { PHYGITAL_TOKEN_PROGRAM_ADDRESS, VERIFY_DISCRIMINATOR } from 'phygital-token-sdk';
import { describe, expect, it, vi } from 'vitest';

import { startEmbedHost, type EmbedAccount } from '#lib/client/wallet/embed-host.ts';
import { ownerLoginMessage } from '#lib/server/accessory/owner-browse.ts';
import {
	BRIDGE_SOURCE_DAPP,
	BRIDGE_VERSION,
	refuseMessage,
	refuseTransaction
} from '#lib/shared/wallet-bridge.ts';

const FRAME = 'https://pay.test';
const PAYER = address('4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw');
const SYSTEM = address('11111111111111111111111111111111');
const SET_OWNER = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function transaction(program: string, data: Uint8Array, version: 'legacy' | 0 | 1 = 0) {
	const message = pipe(
		createTransactionMessage({ version }),
		(m) => setTransactionMessageFeePayer(PAYER, m),
		(m) =>
			setTransactionMessageLifetimeUsingBlockhash(
				{ blockhash: SYSTEM as unknown as Blockhash, lastValidBlockHeight: 0n },
				m
			),
		(m) => appendTransactionMessageInstruction({ programAddress: address(program), data }, m)
	);
	const compiled = compileTransaction(message);
	return {
		wire: new Uint8Array(getTransactionEncoder().encode(compiled)),
		message: compiled.messageBytes
	};
}

describe('what a framed app may get signed', () => {
	it('refuses a sign-in to Revibase or any other site, and a transaction passed off as a message', () => {
		const revibaseLogin = ownerLoginMessage({
			domain: 'portal.revibase.com',
			uri: 'https://portal.revibase.com',
			address: PAYER,
			cluster: 'mainnet',
			nonce: 'n',
			now: 0
		});
		const text = (value: string) => new TextEncoder().encode(value);
		expect(refuseMessage(text(revibaseLogin), FRAME)).toMatch(/portal\.revibase\.com/);
		expect(
			refuseMessage(text(revibaseLogin.replace('portal.revibase.com', 'pay.test')), FRAME)
		).toBeNull();
		expect(refuseMessage(text('Play as this wallet'), FRAME)).toBeNull();
		const { message } = transaction(SYSTEM, new Uint8Array([2, 0, 0, 0]));
		expect(refuseMessage(new Uint8Array(message), FRAME)).toMatch(/transaction/);
	});

	it('refuses any accessory instruction but verify, in every transaction version', () => {
		for (const version of ['legacy', 0, 1] as const) {
			expect(
				refuseTransaction(transaction(PHYGITAL_TOKEN_PROGRAM_ADDRESS, SET_OWNER, version).wire)
			).toMatch(/accessories/);
			const verify = new Uint8Array([...VERIFY_DISCRIMINATOR, 0]);
			expect(
				refuseTransaction(transaction(PHYGITAL_TOKEN_PROGRAM_ADDRESS, verify, version).wire)
			).toBeNull();
			expect(refuseTransaction(transaction(SYSTEM, new Uint8Array([2]), version).wire)).toBeNull();
		}
		expect(refuseTransaction(new Uint8Array([9]))).toMatch(/could not read/);
	});
});

describe('embed host against a hostile frame', () => {
	const account: EmbedAccount = {
		address: PAYER,
		publicKey: new Uint8Array(32),
		chain: 'solana:mainnet'
	};

	function host(approvedAddress: string | null) {
		const contentWindow = { postMessage: vi.fn() };
		let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null =
			null;
		let release: () => void = () => {};
		const signTransaction = vi.fn(
			(bytes: Uint8Array) => new Promise<Uint8Array>((resolve) => (release = () => resolve(bytes)))
		);
		startEmbedHost({
			target: {
				addEventListener: (_t: string, fn: typeof listener) => (listener = fn),
				removeEventListener: () => {}
			} as unknown as EventTarget,
			iframe: { contentWindow },
			expectedOrigin: FRAME,
			approve: async () => true,
			signer: {
				account: () => account,
				signTransaction,
				signMessage: async () => new Uint8Array([1]),
				signAndSendTransaction: async () => new Uint8Array([2])
			},
			storage: {
				getItem: () => (approvedAddress ? JSON.stringify({ [FRAME]: approvedAddress }) : null),
				setItem: () => {}
			}
		});
		const sign = (id: string, bytes: Uint8Array) =>
			listener!({
				source: contentWindow,
				origin: FRAME,
				data: {
					source: BRIDGE_SOURCE_DAPP,
					version: BRIDGE_VERSION,
					id,
					method: 'signTransaction',
					payload: { transaction: bytes, chain: 'solana:mainnet' }
				}
			});
		const answered = (id: string, ok: boolean) =>
			vi.waitFor(() =>
				expect(contentWindow.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({ id, ok }),
					FRAME
				)
			);
		return { sign, answered, signTransaction, release: () => release() };
	}

	const transfer = () => transaction(SYSTEM, new Uint8Array([2, 0, 0, 0])).wire;

	it('signs only with the account that approved this site', async () => {
		const other = host('Other1111111111111111111111111111111111111');
		other.sign('s1', transfer());
		await other.answered('s1', false);
		expect(other.signTransaction).not.toHaveBeenCalled();
	});

	it('shows one prompt at a time and refuses requests that arrive meanwhile', async () => {
		const h = host(PAYER);
		h.sign('s1', transfer());
		await vi.waitFor(() => expect(h.signTransaction).toHaveBeenCalledOnce());
		h.sign('s2', transfer());
		await h.answered('s2', false);
		h.release();
		await h.answered('s1', true);
		expect(h.signTransaction).toHaveBeenCalledOnce();
	});

	it('never reaches the wallet for an owner change', async () => {
		const h = host(PAYER);
		h.sign('s1', transaction(PHYGITAL_TOKEN_PROGRAM_ADDRESS, SET_OWNER).wire);
		await h.answered('s1', false);
		expect(h.signTransaction).not.toHaveBeenCalled();
	});
});
