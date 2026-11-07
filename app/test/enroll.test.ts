import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import {
	address,
	generateKeyPairSigner,
	type Instruction,
	type Rpc,
	type Signature,
	type SolanaRpcApi,
	type V1TransactionConfig
} from '@solana/kit';
import {
	findPhygitalTokenPda,
	getPhygitalTokenEncoder,
	parseInitializeInstruction,
	PHYGITAL_TOKEN_PROGRAM_ADDRESS,
	PhygitalTokenType
} from 'phygital-token-sdk';

import {
	registerCard,
	EnrollError,
	INITIALIZE_BUDGET,
	type EnrollDeps
} from '#lib/server/enroll/initialize.ts';
import {
	BROWSE_SESSION_TTL_MS,
	enrollChallenge,
	readEnrollSession,
	setEnrollSession,
	type CookieJar
} from '#lib/server/session/cookies.ts';
import { DEFAULT_PUBKEY } from '#lib/shared/accessory-view.ts';
import { bytesToBase64, bytesToBase64Url } from '#lib/shared/encoding.ts';
import { attestedCard } from './support/attestation';
import { createTestD1 } from './support/d1-sqlite';
import { ORIGIN } from './support/fixtures';

const SIGNATURE = '5'.repeat(88) as Signature;

/** A chain with no tokens, where every sent `initialize` lands. */
function chainRpc() {
	const accounts = new Map<string, Uint8Array>();
	const rpc = {
		getAccountInfo: (pda: string) => ({
			send: async () => {
				const data = accounts.get(pda);
				return {
					value: data
						? {
								data: [bytesToBase64(data), 'base64'],
								executable: false,
								lamports: 1n,
								owner: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
								space: BigInt(data.length)
							}
						: null
				};
			}
		})
	} as unknown as Rpc<SolanaRpcApi>;
	const land = (pda: string, args: { publicKey: Uint8Array; identifier: Uint8Array }) =>
		accounts.set(
			pda,
			new Uint8Array(
				getPhygitalTokenEncoder().encode({
					owner: address(DEFAULT_PUBKEY),
					reserved: new Uint8Array(32),
					lastSlot: 0n,
					tokenType: PhygitalTokenType.Controlled,
					bump: 0,
					publicKey: [args.publicKey],
					identifier: [args.identifier]
				})
			)
		);
	return { rpc, land };
}

async function setup() {
	const db = createTestD1();
	const sent: Instruction[][] = [];
	const budgets: V1TransactionConfig[] = [];
	const card = attestedCard();
	const chain = chainRpc();
	const deps: EnrollDeps = {
		db,
		rpc: chain.rpc,
		issuer: await generateKeyPairSigner(),
		attestation: { rootCertDers: [card.root], expectedAaguid: card.aaguid },
		send: async (instructions, budget) => {
			sent.push(instructions);
			budgets.push(budget);
			const ix = parseInitializeInstruction(
				instructions[0] as Parameters<typeof parseInitializeInstruction>[0]
			);
			chain.land(ix.accounts.phygitalToken.address, {
				publicKey: new Uint8Array(ix.data.secp256r1Pubkey[0]),
				identifier: new Uint8Array(ix.data.identifier[0])
			});
			return SIGNATURE;
		}
	};
	const identifier = bytesToBase64Url(p256.getPublicKey(p256.utils.randomSecretKey(), true));
	// The enroll session's challenge; every tap of Set up enrolls over it.
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	/** One tap of Set up: the card's enrollment over `clientData`. */
	const attempt = async (clientData: { challenge?: string; origin?: string } = {}) => ({
		identifier,
		challenge,
		response: card.enroll({
			type: 'webauthn.create',
			challenge: bytesToBase64Url(challenge),
			origin: ORIGIN,
			...clientData
		}),
		origin: ORIGIN
	});
	const pda = await findPhygitalTokenPda(card.productKey);
	return { db, deps, sent, budgets, card, identifier, pda, attempt, chain };
}

const code = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e: EnrollError) => e.code
	);

describe('registerCard', () => {
	it('initializes an unowned Controlled token under the tapped identifier and records it', async () => {
		const { db, deps, sent, budgets, card, identifier, pda, attempt } = await setup();

		await expect(registerCard(deps, await attempt())).resolves.toEqual({
			pda,
			signature: SIGNATURE
		});

		expect(sent).toHaveLength(1);
		expect(budgets).toEqual([INITIALIZE_BUDGET]);
		const ix = parseInitializeInstruction(
			sent[0][0] as Parameters<typeof parseInitializeInstruction>[0]
		);
		expect(ix.accounts.authority.address).toBe(deps.issuer.address);
		expect(ix.accounts.phygitalToken.address).toBe(pda);
		expect(ix.data.tokenType).toBe(PhygitalTokenType.Controlled);
		expect(ix.data.owner).toBe(DEFAULT_PUBKEY);
		expect(bytesToBase64Url(new Uint8Array(ix.data.identifier[0]))).toBe(identifier);
		expect(new Uint8Array(ix.data.secp256r1Pubkey[0])).toEqual(card.productKey);

		// Only the webhook writes the chain snapshot.
		expect(await db.prepare('SELECT 1 FROM phygital_tokens').first()).toBeNull();
	});

	it('sends nothing for an enrollment over another challenge or origin, or a forged attestation', async () => {
		const { deps, sent, attempt } = await setup();
		expect(
			await code(
				registerCard(deps, await attempt({ challenge: bytesToBase64Url(new Uint8Array(32)) }))
			)
		).toBe('invalid_attestation');
		expect(await code(registerCard(deps, await attempt({ origin: 'https://evil.example' })))).toBe(
			'invalid_attestation'
		);
		expect(
			await code(
				registerCard(
					{ ...deps, attestation: { rootCertDers: [attestedCard().root] } },
					await attempt()
				)
			)
		).toBe('invalid_attestation');
		expect(sent).toHaveLength(0);
	});

	it('refuses this card when its token carries another identifier', async () => {
		const { deps, sent, card, pda, attempt, chain } = await setup();
		chain.land(pda, {
			publicKey: card.productKey,
			identifier: p256.getPublicKey(p256.utils.randomSecretKey(), true)
		});
		expect(await code(registerCard(deps, await attempt()))).toBe('already_enrolled');
		expect(sent).toHaveLength(0);
	});

	it('runs one enrollment per identifier at a time, and frees it afterwards', async () => {
		const { deps, attempt } = await setup();
		let release!: () => void;
		let sending!: () => void;
		const inSend = new Promise<void>((resolve) => (sending = resolve));
		const first = registerCard(
			{
				...deps,
				send: (instructions, budget) =>
					new Promise<Signature>((resolve) => {
						release = () => resolve(deps.send(instructions, budget));
						sending();
					})
			},
			await attempt()
		);
		await inSend;
		expect(await code(registerCard(deps, await attempt()))).toBe('in_progress');
		release();
		await first;
		// Freed: the next attempt gets past the lock, and finds this card's token on chain.
		await expect(registerCard(deps, await attempt())).resolves.toMatchObject({ signature: null });
	});

	it('retries after a failed send, with the same key the card enrolls again', async () => {
		const { deps, sent, pda, attempt } = await setup();
		const failing = { ...deps, send: () => Promise.reject(new Error('blockhash expired')) };
		await expect(registerCard(failing, await attempt())).rejects.toThrow('blockhash expired');
		// The card's enrollment is idempotent: the next tap attests the same product key.
		await expect(registerCard(deps, await attempt())).resolves.toEqual({
			pda,
			signature: SIGNATURE
		});
		expect(sent).toHaveLength(1);
	});
});

describe('enroll cookie', () => {
	const jar = (): CookieJar => {
		const store = new Map<string, string>();
		return {
			get: (n) => store.get(n),
			set: (n, v) => void store.set(n, v),
			delete: (n) => void store.delete(n)
		};
	};

	it('round-trips the tapped identifier and expires', async () => {
		const cookies = jar();
		const secret = 'x'.repeat(48);
		const now = Date.now();
		await setEnrollSession(cookies, secret, 'chip', now);
		expect((await readEnrollSession(cookies, secret))?.identifier).toBe('chip');
		expect(await readEnrollSession(cookies, 'y'.repeat(48))).toBeNull();
		await setEnrollSession(cookies, secret, 'chip', now - BROWSE_SESSION_TTL_MS - 1);
		expect(await readEnrollSession(cookies, secret)).toBeNull();
	});

	it('gives each session its own fixed challenge, bound to the secret', async () => {
		const secret = 'x'.repeat(48);
		const session = await setEnrollSession(jar(), secret, 'chip');
		const challenge = await enrollChallenge(secret, session);
		expect(challenge).toHaveLength(32);
		expect(await enrollChallenge(secret, session)).toEqual(challenge);
		expect(
			await enrollChallenge(secret, await setEnrollSession(jar(), secret, 'chip'))
		).not.toEqual(challenge);
		expect(await enrollChallenge('y'.repeat(48), session)).not.toEqual(challenge);
	});
});
