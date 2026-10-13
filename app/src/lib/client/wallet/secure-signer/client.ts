/**
 * Host side of the secure-signer protocol: posts requests to the passkey-wallet
 * iframe (its own origin) and waits for the matching result.
 *
 * Trust: the frame is the trust boundary. This page accepts messages only from
 * the signer origin AND its own iframe, and never sees PRF output or keys.
 * The frame has no cancel message, so a cancelled or timed-out request
 * reloads it (otherwise every later request would be rejected as busy).
 */
import {
	PROTOCOL_VERSION,
	RESULT_TYPE,
	SIGNER_ERROR_CODES,
	type HostErrorCode,
	type RequestType,
	type SignerErrorCode
} from 'secure-signer/shared';

import { bytesToBase64 } from '$lib/shared/encoding';

// Matches the backup challenge TTL minted before the confirm screen.
const REQUEST_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 20_000;

/** A code the frame sent, if it's one it may send. */
const knownCode = (code: unknown): SignerErrorCode =>
	(SIGNER_ERROR_CODES as readonly unknown[]).includes(code)
		? (code as SignerErrorCode)
		: 'INTERNAL_ERROR';

export class SecureSignerError extends Error {
	/** What the frame answered, or what the host saw when it didn't. */
	constructor(readonly code: SignerErrorCode | HostErrorCode) {
		super(code);
		this.name = 'SecureSignerError';
	}
}

/** The host component: shows or hides the sheet around the iframe. */
export type SignerShell = { setOpen: (open: boolean) => void; setHeight: (height: number) => void };

type Pending = {
	resultType: string;
	resolve: (data: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const randomRequestId = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
		b.toString(16).padStart(2, '0')
	).join('');

export class SecureSignerClient {
	readonly #origin: string;
	#iframe: HTMLIFrameElement | null = null;
	#shell: SignerShell | null = null;
	#ready = false;
	#readyWaiters: Array<() => void> = [];
	#attachWaiters: Array<() => void> = [];
	readonly #pending = new Map<string, Pending>();

	constructor(origin: string) {
		this.#origin = origin.replace(/\/$/, '');
	}

	get origin() {
		return this.#origin;
	}

	get frameSrc() {
		return `${this.#origin}/`;
	}

	attach(iframe: HTMLIFrameElement, shell: SignerShell): () => void {
		this.#iframe = iframe;
		this.#shell = shell;
		const onMessage = (event: MessageEvent) => this.#onMessage(event);
		window.addEventListener('message', onMessage);
		for (const resolve of this.#attachWaiters.splice(0)) resolve();
		return () => {
			window.removeEventListener('message', onMessage);
			if (this.#iframe === iframe) {
				this.#iframe = null;
				this.#shell = null;
				this.#ready = false;
			}
		};
	}

	/** The user closed the sheet. */
	cancel(): void {
		this.#shell?.setOpen(false);
		if (this.#pending.size > 0) this.#reload();
		for (const [id, p] of this.#pending) {
			clearTimeout(p.timer);
			this.#pending.delete(id);
			p.reject(new SecureSignerError('USER_CANCELLED'));
		}
	}

	#reload(): void {
		if (!this.#iframe) return;
		this.#ready = false;
		this.#iframe.src = `${this.#origin}/?r=${Date.now()}`;
	}

	#onMessage(event: MessageEvent): void {
		if (event.origin !== this.#origin) return;
		if (!this.#iframe || event.source !== this.#iframe.contentWindow) return;
		const data = event.data as Record<string, unknown> | null;
		if (data?.type === 'SIGNER_READY') {
			this.#ready = true;
			for (const resolve of this.#readyWaiters.splice(0)) resolve();
			return;
		}
		if (data?.type === 'SIGNER_HEIGHT') {
			const height = data.height;
			if (typeof height === 'number' && Number.isFinite(height) && height >= 0)
				this.#shell?.setHeight(Math.round(height));
			return;
		}
		const requestId = data?.requestId;
		if (typeof requestId !== 'string') return;
		const p = this.#pending.get(requestId);
		if (!p) return;
		this.#pending.delete(requestId);
		clearTimeout(p.timer);
		if (data!.type === 'ERROR') p.reject(new SecureSignerError(knownCode(data!.code)));
		else if (data!.type === p.resultType) p.resolve(data!);
		else p.reject(new SecureSignerError('INTERNAL_ERROR'));
	}

	#wait(list: Array<() => void>, done: () => boolean): Promise<void> {
		if (done()) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new SecureSignerError('SIGNER_UNAVAILABLE')),
				READY_TIMEOUT_MS
			);
			list.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	async #send(
		type: RequestType,
		payload: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		await this.#wait(this.#attachWaiters, () => !!this.#iframe);
		this.#shell?.setOpen(true);
		await this.#wait(this.#readyWaiters, () => this.#ready);
		const frame = this.#iframe?.contentWindow;
		if (!frame) throw new SecureSignerError('SIGNER_UNAVAILABLE');
		const requestId = randomRequestId();
		const result = new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(requestId);
				this.#reload();
				reject(new SecureSignerError('TIMEOUT'));
			}, REQUEST_TIMEOUT_MS);
			this.#pending.set(requestId, { resultType: RESULT_TYPE[type], resolve, reject, timer });
		});
		frame.postMessage(
			{ type, protocolVersion: PROTOCOL_VERSION, requestId, timestamp: Date.now(), ...payload },
			this.#origin
		);
		return result;
	}

	async #request(
		type: RequestType,
		payload: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		try {
			for (let attempt = 0; ; attempt++) {
				try {
					return await this.#send(type, payload);
				} catch (err) {
					// An earlier request was abandoned mid-ceremony: reset once and retry.
					if (!(err instanceof SecureSignerError && err.code === 'SIGNER_BUSY') || attempt > 0)
						throw err;
					this.#reload();
				}
			}
		} finally {
			this.#shell?.setOpen(false);
		}
	}

	async authenticate(opts: {
		authMode: 'create' | 'unlock';
		credentialId?: string;
		webauthnAttestationObject?: string;
	}): Promise<string> {
		const r = await this.#request('AUTH_START', opts);
		if (typeof r.publicKey !== 'string') throw new SecureSignerError('INTERNAL_ERROR');
		return r.publicKey;
	}

	async signTransaction(
		transaction: Uint8Array
	): Promise<{ signature: string; publicKey: string }> {
		const r = await this.#request('SIGN_TRANSACTION', { transaction: bytesToBase64(transaction) });
		return { signature: String(r.signature), publicKey: String(r.publicKey) };
	}

	async signMessage(message: Uint8Array): Promise<{ signature: string; publicKey: string }> {
		const r = await this.#request('SIGN_MESSAGE', { message: bytesToBase64(message) });
		return { signature: String(r.signature), publicKey: String(r.publicKey) };
	}

	async exportPrivateKey(): Promise<void> {
		await this.#request('EXPORT_PRIVATE_KEY', {});
	}
}
