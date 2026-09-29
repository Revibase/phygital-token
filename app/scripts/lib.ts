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
	partiallySignTransaction,
	pipe,
	sendAndConfirmTransactionFactory,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	getBase64EncodedWireTransaction,
	createNoopSigner,
	type Instruction,
	type KeyPairSigner
} from '@solana/kit';

import { base64UrlToBytes, bytesToBase64Url } from '../src/lib/shared/encoding';
import { buildLinkTransaction, expectationFromPayload, validateLinkTransaction } from '../src/lib/shared/link-transaction';
import type { LinkStatusView, TransferPayload } from '../src/lib/shared/types';

export const APP = process.env.APP_URL ?? 'http://localhost:5173';
export const RP_ID = new URL(APP).hostname;
export const rpc = createSolanaRpc('http://127.0.0.1:8899');
const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });

export let failures = 0;
export function check(label: string, ok: boolean, extra?: unknown) {
	console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
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
	const kp = privateKey ? await createKeyPairSignerFromPrivateKeyBytes(privateKey) : await generateKeyPairSigner();
	await airdrop({ recipientAddress: kp.address, lamports: lamports(2_000_000_000n), commitment: 'confirmed' });
	return kp;
}

export type AccessoryKeys = { ndefKey: string; fidoKey: string; counter: number; signCount: number };

export function fakeAccessory(keys?: AccessoryKeys) {
	const ndefKey = keys ? base64UrlToBytes(keys.ndefKey) : p256.utils.randomSecretKey();
	const fidoKey = keys ? base64UrlToBytes(keys.fidoKey) : p256.utils.randomSecretKey();
	let counter = keys?.counter ?? 100;
	let signCount = keys?.signCount ?? 0;
	return {
		keys: (): AccessoryKeys => ({ ndefKey: bytesToBase64Url(ndefKey), fidoKey: bytesToBase64Url(fidoKey), counter, signCount }),
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
				JSON.stringify({ type: 'webauthn.get', challenge: challengeB64, origin: APP, crossOrigin: false })
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
				type: 'public-key',
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
		return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), origin: APP, ...extra };
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

export async function finish(browser: Browser, linkId: string, wallet: KeyPairSigner) {
	const rec = await browser.post<{ payload: TransferPayload; error?: string }>(`/api/link/${linkId}/recipient`, {
		address: wallet.address
	});
	check(`${browser.name}: server simulated and released the tap to the finisher`, rec.status === 200, rec.body);
	if (rec.status !== 200) return;
	const { value: blockhash } = await rpc.getLatestBlockhash().send();
	const { transaction, wireBytes } = await buildLinkTransaction({
		payload: rec.body.payload,
		rpc,
		recipient: createNoopSigner(wallet.address),
		blockhash
	});
	validateLinkTransaction(wireBytes, expectationFromPayload(rec.body.payload, wallet.address));
	const signed = await partiallySignTransaction([wallet.keyPair], transaction);
	const sig = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64' }).send();
	await browser.post(`/api/link/${linkId}/submitted`, { signature: sig });
	let status: LinkStatusView | null = null;
	for (let i = 0; i < 30; i++) {
		status = (await browser.get<LinkStatusView>(`/api/link/${linkId}`)).body;
		if (status.state === 'linked' || status.state === 'failed') break;
		await new Promise((r) => setTimeout(r, 500));
	}
	check(`${browser.name}: ceremony reached "linked"`, status?.state === 'linked', status);
	return getSignatureFromTransaction(signed);
}

