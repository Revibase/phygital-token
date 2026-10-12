/**
 * Passkey-wallet connect decision tree, framework-free so it can be tested
 * against a fake signer:
 *
 *   remembered address          → that account, no prompt
 *   setup: cancel               → null
 *   setup: create               → AUTH_START create with the app-registered passkey
 *   setup: existing             → AUTH_START unlock (restores when this phone has no key)
 *     NOT_FOUND / AUTHENTICATION_FAILED → "can't find" sheet: try again, create, or cancel
 *   any user cancel             → null
 */
import { SecureSignerError } from './client';

export type CreatedPasskey = { credentialId: string; attestationObject: string };
export type SetupChoice = { mode: 'create'; passkey: CreatedPasskey } | { mode: 'existing' } | { mode: 'cancel' };
export type LostChoice = { mode: 'create'; passkey: CreatedPasskey } | { mode: 'retry' } | { mode: 'cancel' };

export type PasskeySigner = {
	authenticate(opts: { authMode: 'create' | 'unlock'; credentialId?: string; webauthnAttestationObject?: string }): Promise<string>;
};

export function isCancel(err: unknown): boolean {
	if (err instanceof SecureSignerError) return err.code === 'USER_CANCELLED';
	return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

const lost = (err: unknown) => err instanceof SecureSignerError && (err.code === 'NOT_FOUND' || err.code === 'AUTHENTICATION_FAILED');

/** The wallet address, or null when the user backed out. */
export async function runPasskeyConnect(args: {
	remembered: string | null;
	signer: PasskeySigner;
	promptSetup: () => Promise<SetupChoice>;
	promptLost: (reason: 'not_found' | 'failed') => Promise<LostChoice>;
}): Promise<string | null> {
	if (args.remembered) return args.remembered;
	const create = (passkey: CreatedPasskey) =>
		args.signer.authenticate({ authMode: 'create', credentialId: passkey.credentialId, webauthnAttestationObject: passkey.attestationObject });
	try {
		const choice = await args.promptSetup();
		if (choice.mode === 'cancel') return null;
		if (choice.mode === 'create') return await create(choice.passkey);
		for (;;) {
			try {
				return await args.signer.authenticate({ authMode: 'unlock' });
			} catch (err) {
				if (!lost(err)) throw err;
				const next = await args.promptLost((err as SecureSignerError).code === 'NOT_FOUND' ? 'not_found' : 'failed');
				if (next.mode === 'cancel') return null;
				if (next.mode === 'create') return await create(next.passkey);
			}
		}
	} catch (err) {
		if (isCancel(err)) return null;
		throw err;
	}
}

const buf = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

/**
 * Create the passkey on THIS (app) origin: Safari can't create one inside the
 * cross-origin signer frame. Call it synchronously from a click, before any
 * await. Any PRF output is discarded: wrapping material never touches the app.
 */
export async function createPasskey(rpId: string): Promise<CreatedPasskey> {
	const name = `Revibase wallet ${new Date().toISOString().slice(0, 10)}`;
	const cred = (await navigator.credentials.create({
		publicKey: {
			challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
			rp: { id: rpId, name: 'Revibase' },
			user: { id: buf(crypto.getRandomValues(new Uint8Array(16))), name, displayName: name },
			pubKeyCredParams: [
				{ type: 'public-key', alg: -7 },
				{ type: 'public-key', alg: -8 },
				{ type: 'public-key', alg: -257 }
			],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
			extensions: { prf: {} } as AuthenticationExtensionsClientInputs
		}
	})) as PublicKeyCredential | null;
	if (!cred) throw new DOMException('Passkey creation was cancelled', 'NotAllowedError');
	try {
		const first = (cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
		if (first) new Uint8Array(first).fill(0);
	} catch {
		/* nothing to scrub */
	}
	const attestation = cred.response as AuthenticatorAttestationResponse;
	const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return { credentialId: b64url(cred.rawId), attestationObject: b64url(attestation.attestationObject) };
}
