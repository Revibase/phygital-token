import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
	airdropFactory,
	appendTransactionMessageInstructions,
	createSolanaRpc,
	createSolanaRpcSubscriptions,
	createTransactionMessage,
	Endian,
	createKeyPairSignerFromPrivateKeyBytes,
	generateKeyPairSigner,
	getU32Encoder,
	lamports,
	pipe,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	createNoopSigner,
	type Instruction,
	type KeyPairSigner
} from '@solana/kit';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import { beginTransfer, completeTransfer } from 'phygital-token-sdk';

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
			createTransactionMessage({ version: 0 }),
			(m) => setTransactionMessageFeePayerSigner(payer, m),
			(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
			(m) => appendTransactionMessageInstructions(ixs, m)
		)
	);
	await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
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
		webauthn(challengeB64: string) {
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
	async get<T>(path: string): Promise<{ status: number; body: T }> {
		const res = await fetch(`${APP}${path}`, { headers: this.headers() });
		return { status: res.status, body: (await res.json()) as T };
	}
}

export async function finishDirectly(acc: ReturnType<typeof fakeAccessory>, wallet: KeyPairSigner) {
	const session = await beginTransfer({
		rpc,
		secp256r1Pubkey: bytesToBase64Url(acc.passkey),
		rpId: RP_ID
	});
	const response = acc.webauthn(bytesToBase64Url(session.challenge));
	const instructions = await completeTransfer(session, response, createNoopSigner(wallet.address));
	await send(wallet, instructions);
}
