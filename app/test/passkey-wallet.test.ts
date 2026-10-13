import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	appendTransactionMessageInstructions,
	compileTransaction,
	createNoopSigner,
	createTransactionMessage,
	getTransactionDecoder,
	getTransactionEncoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Blockhash
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features';
import { StandardConnect, StandardDisconnect } from '@wallet-standard/features';

import {
	SecureSignerError,
	type SecureSignerClient
} from '$lib/client/wallet/secure-signer/client';
import {
	runPasskeyConnect,
	type LostChoice,
	type SetupChoice
} from '$lib/client/wallet/secure-signer/connect';
import { PasskeyWallet } from '$lib/client/wallet/secure-signer/wallet';
import { bytesToBase64 } from '$lib/shared/encoding';

const ADDRESS = '7Yu3oPKm7hSbcX3u7ke1HMuiKeuuSJo4iQ8PYP6VGkCN';
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const passkey = { credentialId: 'cred', attestationObject: 'att' };

let storage: Map<string, string>;
beforeEach(() => {
	storage = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		removeItem: (k: string) => storage.delete(k)
	});
});
afterEach(() => vi.unstubAllGlobals());

function signer(results: Array<string | Error>) {
	const calls: unknown[] = [];
	return {
		calls,
		authenticate: vi.fn(async (opts: unknown) => {
			calls.push(opts);
			const next = results.shift();
			if (next instanceof Error) throw next;
			return next ?? ADDRESS;
		})
	};
}

describe('runPasskeyConnect', () => {
	const run = (
		s: ReturnType<typeof signer>,
		setup: SetupChoice,
		lost: LostChoice[] = [],
		remembered: string | null = null
	) =>
		runPasskeyConnect({
			remembered,
			signer: s,
			promptSetup: async () => setup,
			promptLost: async () => lost.shift() ?? { mode: 'cancel' }
		});

	it('returns a remembered account without asking anything', async () => {
		const s = signer([]);
		expect(await run(s, { mode: 'cancel' }, [], OTHER)).toBe(OTHER);
		expect(s.calls).toEqual([]);
	});

	it('creates with the app-registered passkey', async () => {
		const s = signer([ADDRESS]);
		expect(await run(s, { mode: 'create', passkey })).toBe(ADDRESS);
		expect(s.calls).toEqual([
			{ authMode: 'create', credentialId: 'cred', webauthnAttestationObject: 'att' }
		]);
	});

	it('unlocks an existing wallet (restoring when this phone has no key)', async () => {
		const s = signer([ADDRESS]);
		expect(await run(s, { mode: 'existing' })).toBe(ADDRESS);
		expect(s.calls).toEqual([{ authMode: 'unlock' }]);
	});

	it('an unknown passkey offers try again, then create', async () => {
		const s = signer([
			new SecureSignerError('NOT_FOUND'),
			new SecureSignerError('AUTHENTICATION_FAILED'),
			ADDRESS
		]);
		expect(
			await run(s, { mode: 'existing' }, [{ mode: 'retry' }, { mode: 'create', passkey }])
		).toBe(ADDRESS);
		expect(s.calls).toEqual([
			{ authMode: 'unlock' },
			{ authMode: 'unlock' },
			{ authMode: 'create', credentialId: 'cred', webauthnAttestationObject: 'att' }
		]);
	});

	it('every cancel ends quietly', async () => {
		expect(await run(signer([]), { mode: 'cancel' })).toBeNull();
		expect(
			await run(signer([new SecureSignerError('NOT_FOUND')]), { mode: 'existing' }, [
				{ mode: 'cancel' }
			])
		).toBeNull();
		expect(
			await run(signer([new SecureSignerError('USER_CANCELLED')]), { mode: 'existing' })
		).toBeNull();
	});

	it('other errors surface', async () => {
		await expect(
			run(signer([new SecureSignerError('PRF_UNSUPPORTED')]), { mode: 'existing' })
		).rejects.toMatchObject({ code: 'PRF_UNSUPPORTED' });
	});
});

describe('PasskeyWallet (Wallet Standard)', () => {
	const fakeClient = (overrides: Partial<SecureSignerClient> = {}) =>
		({
			authenticate: async () => ADDRESS,
			signTransaction: async () => ({
				signature: bytesToBase64(new Uint8Array(64).fill(9)),
				publicKey: ADDRESS
			}),
			signMessage: async () => ({
				signature: bytesToBase64(new Uint8Array(64).fill(4)),
				publicKey: ADDRESS
			}),
			exportPrivateKey: async () => {},
			...overrides
		}) as unknown as SecureSignerClient;
	const prompts = {
		setup: async (): Promise<SetupChoice> => ({ mode: 'existing' }),
		lost: async (): Promise<LostChoice> => ({ mode: 'cancel' })
	};

	function wire(feePayer: string) {
		const message = pipe(
			createTransactionMessage({ version: 0 }),
			(m) => setTransactionMessageFeePayer(feePayer as never, m),
			(m) =>
				setTransactionMessageLifetimeUsingBlockhash(
					{
						blockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM' as Blockhash,
						lastValidBlockHeight: 1n
					},
					m
				),
			(m) =>
				appendTransactionMessageInstructions(
					[
						getTransferSolInstruction({
							source: createNoopSigner(feePayer as never),
							destination: OTHER as never,
							amount: 1n
						})
					],
					m
				)
		);
		return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
	}

	it('silent connect stays empty until the user connects, then remembers the account', async () => {
		const wallet = new PasskeyWallet(fakeClient(), prompts);
		expect((await wallet.features[StandardConnect].connect({ silent: true })).accounts).toEqual([]);
		const { accounts } = await wallet.features[StandardConnect].connect();
		expect(accounts[0]?.address).toBe(ADDRESS);
		expect(new PasskeyWallet(fakeClient(), prompts).accounts[0]?.address).toBe(ADDRESS);
		await wallet.features[StandardDisconnect].disconnect();
		expect(wallet.accounts).toEqual([]);
		expect(storage.size).toBe(0);
	});

	it('a cancelled connect rejects like any wallet', async () => {
		const wallet = new PasskeyWallet(fakeClient(), {
			...prompts,
			setup: async () => ({ mode: 'cancel' })
		});
		await expect(wallet.features[StandardConnect].connect()).rejects.toMatchObject({
			name: 'NotAllowedError'
		});
	});

	it('merges the signer’s signature into the transaction', async () => {
		const wallet = new PasskeyWallet(fakeClient(), prompts);
		const [account] = (await wallet.features[StandardConnect].connect()).accounts;
		const [out] = await wallet.features[SolanaSignTransaction].signTransaction({
			account: account!,
			transaction: wire(ADDRESS)
		});
		const signed = getTransactionDecoder().decode(out!.signedTransaction);
		expect([...(signed.signatures[ADDRESS as never] ?? [])]).toEqual(Array(64).fill(9));
	});

	it('refuses a signature for another key, or a transaction it does not sign', async () => {
		const wallet = new PasskeyWallet(
			fakeClient({
				signTransaction: async () => ({
					signature: bytesToBase64(new Uint8Array(64)),
					publicKey: OTHER
				})
			}),
			prompts
		);
		const [account] = (await wallet.features[StandardConnect].connect()).accounts;
		await expect(
			wallet.features[SolanaSignTransaction].signTransaction({
				account: account!,
				transaction: wire(ADDRESS)
			})
		).rejects.toThrow();
		const honest = new PasskeyWallet(fakeClient(), prompts);
		await expect(
			honest.features[SolanaSignTransaction].signTransaction({
				account: account!,
				transaction: wire(OTHER)
			})
		).rejects.toThrow(/not a signer/);
	});

	it('signs messages', async () => {
		const wallet = new PasskeyWallet(fakeClient(), prompts);
		const [account] = (await wallet.features[StandardConnect].connect()).accounts;
		const message = new TextEncoder().encode('hello');
		const [out] = await wallet.features[SolanaSignMessage].signMessage({
			account: account!,
			message
		});
		expect(out).toEqual({ signedMessage: message, signature: new Uint8Array(64).fill(4) });
	});
});
