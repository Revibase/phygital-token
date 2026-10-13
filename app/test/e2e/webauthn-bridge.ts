/**
 * One virtual authenticator for a whole browser context, shared by every frame.
 *
 * The passkey wallet is created on the app's top-level origin and then used by
 * the cross-origin signer iframe, so both must talk to the same authenticator,
 * as they do on a real phone. The authenticator runs here, in the test process;
 * webauthn-shim.js forwards each frame's navigator.credentials call to it and
 * rebuilds a browser-shaped credential from the reply.
 *
 * NFC accessories answer only ceremonies that ask for an NFC credential (the
 * SDK's tap requests), and only while the test holds one to the reader.
 */
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Frame } from 'playwright';
import {
	VirtualAuthenticator,
	type VirtualCredential,
	type WebAuthnFault
} from 'secure-signer/testing/kit';

type Encoded = unknown;
type Ceremony = {
	op: 'create' | 'get';
	origin: string;
	topOrigin?: string;
	rpId?: string;
	ok: boolean;
	error?: string;
	nfc: boolean;
};

const SHIM = fileURLToPath(new URL('./webauthn-shim.js', import.meta.url));

const toB64 = (bytes: Uint8Array) => ({ __b64: Buffer.from(bytes).toString('base64') });
const bytesOf = (value: ArrayBuffer | ArrayBufferView) =>
	value instanceof ArrayBuffer
		? new Uint8Array(value)
		: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

function encode(value: unknown): Encoded {
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return toB64(bytesOf(value));
	if (Array.isArray(value)) return value.map(encode);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value))
			if (typeof v !== 'function' && v !== undefined) out[k] = encode(v);
		return out;
	}
	return value;
}

function decode(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decode);
	if (value && typeof value === 'object') {
		const b64 = (value as { __b64?: unknown }).__b64;
		if (typeof b64 === 'string') return new Uint8Array(Buffer.from(b64, 'base64'));
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = decode(v);
		return out;
	}
	return value;
}

const originOf = (frame: Frame) => new URL(frame.url()).origin;

export class WebAuthnBridge {
	readonly va: VirtualAuthenticator;
	/** Every ceremony, in order: which frame asked, and how it ended. */
	readonly ceremonies: Ceremony[] = [];
	/** PRF outputs handed to pages; nothing outside the signer may ever echo them. */
	readonly prfOutputs: Uint8Array[] = [];
	private held: Uint8Array | null = null;

	/** Each bridge is a separate phone: a fresh seed means fresh credential ids. */
	constructor(seed = `revibase-e2e-${crypto.randomUUID()}`) {
		this.va = new VirtualAuthenticator({ seed, counter: 'increment' });
	}

	async install(context: BrowserContext) {
		await context.exposeBinding('__webauthn', ({ frame }, op: 'create' | 'get', options: unknown) =>
			this.handle(frame, op, options)
		);
		await context.addInitScript({ path: SHIM });
	}

	/** Hold an accessory to the reader; `signCount` must exceed what the chain last saw. */
	holdAccessory(privateKey: Uint8Array, signCount = 0): VirtualCredential {
		const cred =
			this.va
				.list()
				.find((c) => c.nfcAccessory && Buffer.from(c.privateKey).equals(Buffer.from(privateKey))) ??
			this.va.importAccessory(privateKey);
		if (signCount > cred.signCount) this.va.setSignCount(cred.id, signCount);
		this.held = cred.id;
		return cred;
	}

	/** Take the accessory away: tap requests now find nothing, like a real reader. */
	releaseAccessory() {
		this.held = null;
	}

	failNext(fault: WebAuthnFault, op: 'create' | 'get' | 'any' = 'any') {
		this.va.failNext(fault, op);
	}

	/** Passkeys (not accessories) created so far. */
	passkeys() {
		return this.va.list().filter((c) => !c.nfcAccessory);
	}

	private async handle(frame: Frame, op: 'create' | 'get', options: unknown) {
		const origin = originOf(frame);
		const top = frame.page().mainFrame();
		const topOrigin = frame === top ? undefined : originOf(top);
		const decoded = decode(options) as {
			publicKey?: {
				rpId?: string;
				rp?: { id?: string };
				allowCredentials?: { transports?: string[] }[];
			};
		};
		const nfc =
			op === 'get' &&
			!!decoded.publicKey?.allowCredentials?.some((c) => c.transports?.includes('nfc'));
		this.va.presentAccessory(nfc ? this.held : null);
		const record: Ceremony = {
			op,
			origin,
			topOrigin,
			rpId: decoded.publicKey?.rpId ?? decoded.publicKey?.rp?.id,
			ok: false,
			nfc
		};
		this.ceremonies.push(record);
		try {
			const ctx = { origin, topOrigin };
			const cred =
				op === 'create'
					? await this.va.create(decoded as never, ctx)
					: await this.va.get(decoded as never, ctx);
			const extensions = cred.getClientExtensionResults() as {
				prf?: { results?: { first?: ArrayBuffer; second?: ArrayBuffer } };
			};
			for (const out of [extensions.prf?.results?.first, extensions.prf?.results?.second])
				if (out) this.prfOutputs.push(new Uint8Array(out));
			const r = cred.response as unknown as Record<string, unknown> & {
				getTransports?: () => string[];
				getAuthenticatorData?: () => ArrayBuffer;
				getPublicKey?: () => ArrayBuffer;
				getPublicKeyAlgorithm?: () => number;
			};
			const response = r.getAuthenticatorData
				? {
						clientDataJSON: r.clientDataJSON,
						attestationObject: r.attestationObject,
						authenticatorData: r.getAuthenticatorData(),
						publicKey: r.getPublicKey!(),
						publicKeyAlgorithm: r.getPublicKeyAlgorithm!(),
						transports: r.getTransports!()
					}
				: r;
			record.ok = true;
			return {
				credential: encode({
					id: cred.id,
					rawId: cred.rawId,
					authenticatorAttachment: nfc ? 'cross-platform' : cred.authenticatorAttachment,
					response,
					extensions
				})
			};
		} catch (e) {
			const err = e as { name?: string; message?: string };
			record.error = err.name ?? 'Error';
			return {
				error: {
					name: err.name && err.name !== 'Error' ? err.name : 'NotAllowedError',
					message: err.message ?? 'WebAuthn failed'
				}
			};
		}
	}
}
