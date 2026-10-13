import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	address,
	airdropFactory,
	appendTransactionMessageInstructions,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
	Endian,
	createKeyPairSignerFromPrivateKeyBytes,
	generateKeyPairSigner,
	getSignatureFromTransaction,
	getU32Encoder,
	lamports,
	assertIsTransactionWithinSizeLimit,
	partiallySignTransaction,
	pipe,
	sendAndConfirmTransactionFactory,
	setTransactionMessageConfig,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	createNoopSigner,
	compileTransaction,
	type Instruction,
	type KeyPairSigner,
	type TransactionSigner
} from '@solana/kit';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import {
	buildLinkInstructions,
	buildLinkTransaction,
	LINK_COMPUTE_UNIT_LIMIT,
	linkExpectation,
	v1MessageConfig,
	validateLinkTransaction,
	type LinkTap
} from '../src/lib/shared/link-transaction';
import {
	beginTransfer,
	createSponsorFeePayer,
	fetchSponsor,
	findAdminConfigPda,
	findPhygitalTokenPda,
	getCreateConfigInstructionAsync,
	getInitializeInstructionAsync,
	getSetIssuerInstructionAsync,
	getSetMinterInstructionAsync,
	pickFeePayer,
	PhygitalTokenType,
	type AuthenticationResponseJSON
} from 'phygital-token-sdk';

export const APP = process.env.APP_URL ?? 'http://localhost:5173';
export const RP_ID = new URL(APP).hostname;
export const rpc = createSolanaRpc('http://127.0.0.1:8899');
const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

export let failures = 0;
export function check(label: string, ok: boolean, extra?: unknown) {
	console.log(
		`${ok ? '  ✓' : '  ✗'} ${label}${ok || extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`
	);
	if (!ok) failures++;
}

export async function send(payer: KeyPairSigner, ixs: Instruction[]) {
	const { value: blockhash } = await rpc.getLatestBlockhash().send();
	const tx = await signTransactionMessageWithSigners(
		pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayerSigner(payer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
			(m) =>
				setTransactionMessageConfig(
					{ computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 },
					m
				),
			(m) => appendTransactionMessageInstructions(ixs, m)
		)
	);
	await sendAndConfirm(tx as unknown as Parameters<typeof sendAndConfirm>[0], {
		commitment: 'confirmed'
	});
}

export async function funded(privateKey?: Uint8Array) {
	const kp = privateKey
		? await createKeyPairSignerFromPrivateKeyBytes(privateKey)
		: await generateKeyPairSigner();
	await airdrop({
		recipientAddress: kp.address,
		lamports: lamports(2_000_000_000n),
		commitment: 'confirmed'
	});
	return kp;
}

export type AccessoryKeys = {
	ndefKey: string;
	fidoKey: string;
	counter: number;
	signCount: number;
};

export function fakeAccessory(keys?: AccessoryKeys) {
	const ndefKey = keys ? base64UrlToBytes(keys.ndefKey) : p256.utils.randomSecretKey();
	const fidoKey = keys ? base64UrlToBytes(keys.fidoKey) : p256.utils.randomSecretKey();
	let counter = keys?.counter ?? 100;
	let signCount = keys?.signCount ?? 0;
	return {
		keys: (): AccessoryKeys => ({
			ndefKey: bytesToBase64Url(ndefKey),
			fidoKey: bytesToBase64Url(fidoKey),
			counter,
			signCount
		}),
		/** The FIDO key, for a browser test's virtual authenticator to tap with. */
		fidoKey,
		identifier: p256.getPublicKey(ndefKey),
		passkey: p256.getPublicKey(fidoKey),
		tapUrl() {
			counter += 1;
			const nonce = crypto.getRandomValues(new Uint8Array(8));
			const msg = new Uint8Array(12);
			msg.set(getU32Encoder({ endian: Endian.Big }).encode(counter), 0);
			msg.set(nonce, 4);
			const q = new URLSearchParams({
				pk: bytesToBase64Url(p256.getPublicKey(ndefKey)),
				c: String(counter),
				n: bytesToBase64Url(nonce),
				s: bytesToBase64Url(p256.sign(msg, ndefKey))
			});
			return `${APP}/accessory?${q}`;
		},
		webauthn(challengeB64: string): AuthenticationResponseJSON {
			signCount += 1;
			const clientData = new TextEncoder().encode(
				JSON.stringify({
					type: 'webauthn.get',
					challenge: challengeB64,
					origin: APP,
					crossOrigin: false
				})
			);
			const authData = new Uint8Array(37);
			authData.set(sha256(new TextEncoder().encode(RP_ID)), 0);
			authData[32] = 0x01;
			new DataView(authData.buffer).setUint32(33, signCount, false);
			const signed = new Uint8Array(69);
			signed.set(authData);
			signed.set(sha256(clientData), 37);
			const id = bytesToBase64Url(p256.getPublicKey(fidoKey));
			return {
				id,
				rawId: id,
				type: 'public-key' as const,
				clientExtensionResults: {},
				response: {
					clientDataJSON: bytesToBase64Url(clientData),
					authenticatorData: bytesToBase64Url(authData),
					signature: bytesToBase64Url(p256.sign(signed, fidoKey, { format: 'der' }))
				}
			};
		}
	};
}

const UNSET = address('11111111111111111111111111111111');

/** AdminConfig with a fresh admin, issuer and minter on a reset validator. */
export async function createAdmin() {
	const [adminConfig] = await findAdminConfigPda();
	if ((await rpc.getAccountInfo(adminConfig, { encoding: 'base64' }).send()).value) {
		throw new Error('AdminConfig already exists; restart the validator with --reset first.');
	}
	const admin = await funded();
	const issuerKey = crypto.getRandomValues(new Uint8Array(32));
	const issuer = await funded(issuerKey);
	await send(admin, [await getCreateConfigInstructionAsync({ authority: admin })]);
	await send(admin, [await getSetIssuerInstructionAsync({ admin, issuer: issuer.address })]);
	const minterKey = crypto.getRandomValues(new Uint8Array(32));
	const minter = await funded(minterKey);
	await send(admin, [await getSetMinterInstructionAsync({ admin, minter: minter.address })]);
	return { issuerKey, minterKey, issuer: issuer.address };
}

export type AccessoryKind = 'bearer' | 'controlled' | 'permanent';

/** Issues a new software accessory; a Permanent one is owned by a fresh wallet. */
export async function issueAccessory(issuerKey: Uint8Array, kind: AccessoryKind) {
	const issuer = await funded(issuerKey);
	const [adminConfig] = await findAdminConfigPda();
	const acc = fakeAccessory();
	const pda = await findPhygitalTokenPda([acc.passkey]);
	const tokenType = {
		bearer: PhygitalTokenType.Bearer,
		controlled: PhygitalTokenType.Controlled,
		permanent: PhygitalTokenType.Permanent
	}[kind];
	if (tokenType === undefined) throw new Error(`unknown type ${kind}`);
	// Permanent must name its wallet at initialize.
	const owner = tokenType === PhygitalTokenType.Permanent ? (await funded()).address : UNSET;
	await send(issuer, [
		await getInitializeInstructionAsync({
			authority: issuer,
			adminConfig,
			phygitalToken: pda,
			identifier: [acc.identifier],
			secp256r1Pubkey: [acc.passkey],
			tokenType,
			owner
		})
	]);
	return { acc, pda };
}

export class Browser {
	cookies = new Map<string, string>();
	constructor(readonly name: string) {}
	private absorb(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair] = c.split(';');
			const [k, v] = pair.split('=');
			if (/max-age=0/i.test(c) || v === '') this.cookies.delete(k);
			else this.cookies.set(k, v);
		}
	}
	private headers(extra: Record<string, string> = {}) {
		return {
			cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
			origin: APP,
			...extra
		};
	}
	async open(url: string) {
		const res = await fetch(url, { redirect: 'manual', headers: this.headers() });
		this.absorb(res);
		return { status: res.status, location: res.headers.get('location') };
	}
	async post<T>(path: string, body: unknown = {}): Promise<{ status: number; body: T }> {
		const res = await fetch(`${APP}${path}`, {
			method: 'POST',
			headers: this.headers({ 'content-type': 'application/json' }),
			body: JSON.stringify(body)
		});
		this.absorb(res);
		return { status: res.status, body: (await res.json()) as T };
	}
	async get<T>(path: string): Promise<{ status: number; body: T }> {
		const res = await fetch(`${APP}${path}`, { headers: this.headers() });
		return { status: res.status, body: (await res.json()) as T };
	}
}

/** Taps `acc` over a fresh slot-bound transfer challenge, as the link page does. */
export async function tapForLink(acc: ReturnType<typeof fakeAccessory>): Promise<LinkTap> {
	const session = await beginTransfer({
		rpc,
		secp256r1Pubkey: bytesToBase64Url(acc.passkey),
		rpId: RP_ID
	});
	return { session, response: acc.webauthn(bytesToBase64Url(session.challenge)) };
}

/** Links `acc` to `wallet`, which pays the fee: tap, build, check the bytes, sign and send. */
export async function link(acc: ReturnType<typeof fakeAccessory>, wallet: KeyPairSigner) {
	const tap = await tapForLink(acc);
	const { value: blockhash } = await rpc.getLatestBlockhash().send();
	const { transaction, wireBytes } = await buildLinkTransaction({
		tap,
		recipient: createNoopSigner(wallet.address),
		blockhash
	});
	validateLinkTransaction(wireBytes, linkExpectation(tap, wallet.address));
	const signed = await partiallySignTransaction([wallet.keyPair], transaction);
	await sendAndConfirm(signed as never, { commitment: 'confirmed' });
	return getSignatureFromTransaction(signed);
}

export const SPONSOR = `${APP}/api/sponsor`;

/** The accessory's prepaid network fees, as the fee service reports them. */
export async function prepaid(pda: string) {
	const info = await fetchSponsor({ endpoint: SPONSOR, phygitalToken: pda as never });
	return { feePayers: info.feePayers, balance: info.prepaid!.balanceLamports };
}

/**
 * Sends `build`'s instructions with a Revibase fee payer, as the app does for
 * an owner without SOL: the owner signs, then the fee service.
 */
export async function sendSponsored(
	pda: string,
	owner: KeyPairSigner,
	build: (feePayer: TransactionSigner) => Promise<Instruction[]>,
	units = 200_000
) {
	const { feePayers } = await prepaid(pda);
	const sponsor = createSponsorFeePayer(pickFeePayer(feePayers), { endpoint: SPONSOR });
	const feePayer = createNoopSigner(sponsor.address);
	const instructions = await build(feePayer);
	const { value: blockhash } = await rpc.getLatestBlockhash().send();
	const unsigned = compileTransaction(
		pipe(
			createTransactionMessage({ version: 1 }),
			(m) => setTransactionMessageFeePayerSigner(feePayer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
			(m) => setTransactionMessageConfig(v1MessageConfig(units), m),
			(m) => appendTransactionMessageInstructions(instructions, m)
		)
	);
	const ownerSigned = await partiallySignTransaction([owner.keyPair], unsigned);
	assertIsTransactionWithinSizeLimit(ownerSigned);
	const [sponsorSignature] = await sponsor.signTransactions([ownerSigned]);
	const tx = { ...ownerSigned, signatures: { ...ownerSigned.signatures, ...sponsorSignature } };
	await sendAndConfirm(tx as unknown as Parameters<typeof sendAndConfirm>[0], {
		commitment: 'confirmed'
	});
	return { feePayer: sponsor.address, signature: getSignatureFromTransaction(tx) };
}

/** `link`, for a recipient with no SOL: a Revibase fee payer pays for it. */
export async function linkSponsored(acc: ReturnType<typeof fakeAccessory>, wallet: KeyPairSigner) {
	const tap = await tapForLink(acc);
	return sendSponsored(
		tap.session.phygitalToken,
		wallet,
		() => buildLinkInstructions(tap, createNoopSigner(wallet.address)),
		LINK_COMPUTE_UNIT_LIMIT
	);
}
