/**
 * "Revibase Passkey" as a Wallet Standard wallet, so `@solana/connector` lists
 * it next to detected wallets. Keys live in the secure-signer iframe; this
 * page only forwards requests and merges the returned signature.
 */
import { getAddressEncoder, getTransactionDecoder, getTransactionEncoder, type Address, type SignatureBytes } from '@solana/kit';
import {
	SolanaSignMessage,
	SolanaSignTransaction,
	type SolanaSignMessageFeature,
	type SolanaSignMessageMethod,
	type SolanaSignTransactionFeature,
	type SolanaSignTransactionMethod
} from '@solana/wallet-standard-features';
import type { IdentifierArray, Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import {
	StandardConnect,
	StandardDisconnect,
	StandardEvents,
	type StandardConnectFeature,
	type StandardConnectMethod,
	type StandardDisconnectFeature,
	type StandardDisconnectMethod,
	type StandardEventsFeature,
	type StandardEventsListeners,
	type StandardEventsOnMethod
} from '@wallet-standard/features';

import { base64ToBytes } from '$lib/shared/encoding';
import type { SecureSignerClient } from './client';
import { runPasskeyConnect, type LostChoice, type SetupChoice } from './connect';

export const PASSKEY_WALLET_NAME = 'Revibase Passkey';
export const PASSKEY_WALLET_HINT = 'Face ID or fingerprint · no app needed';
const REMEMBERED = 'revibase:signer:account';
const CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'] as const;

export const PASSKEY_WALLET_ICON = `data:image/svg+xml;base64,${btoa(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#00968D"/><circle cx="26" cy="24" r="9" fill="none" stroke="#fff" stroke-width="5"/><path d="M14 50c0-8 5-13 12-13 4 0 7 1 9 3" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M44 30v20m0-20a6 6 0 1 1 0 .1M44 44h5m-5 5h4" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>'
)}` as WalletIcon;

function remembered(): string | null {
	try {
		return localStorage.getItem(REMEMBERED);
	} catch {
		return null;
	}
}
function remember(address: string | null) {
	try {
		if (address) localStorage.setItem(REMEMBERED, address);
		else localStorage.removeItem(REMEMBERED);
	} catch {}
}

type Prompts = { setup: () => Promise<SetupChoice>; lost: (reason: 'not_found' | 'failed') => Promise<LostChoice> };

export class PasskeyWallet implements Wallet {
	readonly version = '1.0.0' as const;
	readonly name = PASSKEY_WALLET_NAME;
	readonly icon = PASSKEY_WALLET_ICON;
	readonly chains = CHAINS as unknown as IdentifierArray;
	#account: WalletAccount | null = null;
	#listeners: StandardEventsListeners['change'][] = [];
	readonly #signer: SecureSignerClient;
	readonly #prompts: Prompts;

	constructor(signer: SecureSignerClient, prompts: Prompts) {
		this.#signer = signer;
		this.#prompts = prompts;
		const saved = remembered();
		if (saved) this.#setAccount(saved);
	}

	get accounts() {
		return this.#account ? [this.#account] : [];
	}

	get features(): StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignTransactionFeature & SolanaSignMessageFeature {
		return {
			[StandardConnect]: { version: '1.0.0', connect: this.#connect },
			[StandardDisconnect]: { version: '1.0.0', disconnect: this.#disconnect },
			[StandardEvents]: { version: '1.0.0', on: this.#on },
			[SolanaSignTransaction]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0, 1], signTransaction: this.#signTransaction },
			[SolanaSignMessage]: { version: '1.1.0', signMessage: this.#signMessage }
		};
	}

	#setAccount(address: string | null) {
		remember(address);
		this.#account = address
			? Object.freeze({
					address,
					publicKey: new Uint8Array(getAddressEncoder().encode(address as Address)),
					chains: this.chains,
					features: [SolanaSignTransaction, SolanaSignMessage] as IdentifierArray,
					label: PASSKEY_WALLET_NAME,
					icon: PASSKEY_WALLET_ICON
				})
			: null;
		for (const listener of this.#listeners) listener({ accounts: this.accounts });
	}

	#on: StandardEventsOnMethod = (_event, listener) => {
		this.#listeners.push(listener);
		return () => {
			this.#listeners = this.#listeners.filter((l) => l !== listener);
		};
	};

	#connect: StandardConnectMethod = async (input) => {
		const saved = remembered();
		if (input?.silent && !saved) return { accounts: [] };
		const address = await runPasskeyConnect({ remembered: saved, signer: this.#signer, promptSetup: this.#prompts.setup, promptLost: this.#prompts.lost });
		if (!address) throw new DOMException('Connection cancelled', 'NotAllowedError');
		if (address !== this.#account?.address) this.#setAccount(address);
		return { accounts: this.accounts };
	};

	#disconnect: StandardDisconnectMethod = async () => {
		this.#setAccount(null);
	};

	#requireAccount(account: WalletAccount) {
		if (!this.#account || account.address !== this.#account.address) throw new Error('Account not connected to Revibase Passkey');
	}

	#signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
		const out: { signedTransaction: Uint8Array }[] = [];
		for (const input of inputs) {
			this.#requireAccount(input.account);
			const { signature, publicKey } = await this.#signer.signTransaction(input.transaction);
			const bytes = base64ToBytes(signature);
			if (publicKey !== input.account.address || bytes.length !== 64) throw new Error('Revibase Passkey returned an unexpected signature');
			const tx = getTransactionDecoder().decode(input.transaction);
			if (!(publicKey in tx.signatures)) throw new Error('This wallet is not a signer of the transaction');
			const signed = { ...tx, signatures: { ...tx.signatures, [publicKey]: bytes as unknown as SignatureBytes } };
			out.push({ signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) });
		}
		return out;
	};

	#signMessage: SolanaSignMessageMethod = async (...inputs) => {
		const out: { signedMessage: Uint8Array; signature: Uint8Array }[] = [];
		for (const input of inputs) {
			this.#requireAccount(input.account);
			const { signature, publicKey } = await this.#signer.signMessage(input.message);
			const bytes = base64ToBytes(signature);
			if (publicKey !== input.account.address || bytes.length !== 64) throw new Error('Revibase Passkey returned an unexpected signature');
			out.push({ signedMessage: input.message, signature: bytes });
		}
		return out;
	};

	/** Shows the key inside the signer frame only. */
	exportKey() {
		return this.#signer.exportPrivateKey();
	}
}
