import { ed25519 } from '@noble/curves/ed25519.js';
import type { WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';
import { SolanaSignMessage, SolanaSignTransaction } from '@solana/wallet-standard-features';
import { getTransactionDecoder, getTransactionEncoder, type SignatureBytes } from '@solana/kit';

const KEY = 'revibase-dev-wallet-secret-v1';
const SESSION_KEY = 'revibase-dev-wallet-secret-v1';
const CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'] as const;
const ICON =
	'data:image/svg+xml;base64,' +
	btoa(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="14" fill="#151515"/><path d="M12 16h24v5H12zm0 11h24v5H12z" fill="#b8ff65"/></svg>'
	);

let unregister: (() => void) | undefined;

function getSecretKey(): Uint8Array {
	const stored = localStorage.getItem(KEY) ?? sessionStorage.getItem(SESSION_KEY);
	if (stored) {
		const key = Uint8Array.from(atob(stored), (char) => char.charCodeAt(0));
		if (key.length === 32) {
			localStorage.setItem(KEY, stored);
			return key;
		}
	}
	const secretKey = ed25519.utils.randomSecretKey();
	localStorage.setItem(KEY, btoa(String.fromCharCode(...secretKey)));
	return secretKey;
}

/** Sign as `address` with kit's codec, which reads every version (v1 puts its signatures elsewhere). */
function signWireTransaction(transaction: Uint8Array, address: string, secretKey: Uint8Array) {
	let tx;
	try {
		tx = getTransactionDecoder().decode(transaction);
	} catch {
		throw new Error('Malformed Solana transaction.');
	}
	if (!(address in tx.signatures))
		throw new Error('The development wallet is not a signer for this transaction.');
	const signature = ed25519.sign(new Uint8Array(tx.messageBytes), secretKey) as SignatureBytes;
	return new Uint8Array(
		getTransactionEncoder().encode({
			...tx,
			signatures: { ...tx.signatures, [address]: signature }
		})
	);
}

/** Register a persistent Wallet Standard test wallet for local development only. */
export async function registerDevMockWallet() {
	if (unregister) return;
	const { getWallets } = await import('@wallet-standard/app');
	const key = getSecretKey();
	const publicKey = ed25519.getPublicKey(key);
	const address = encodeBase58(publicKey);
	let accounts: readonly WalletAccount[] = [];
	const listeners = new Set<(event: { accounts: readonly WalletAccount[] }) => void>();
	const account: WalletAccount = {
		address,
		publicKey,
		chains: CHAINS,
		features: [SolanaSignMessage, SolanaSignTransaction],
		label: 'Local test account'
	};
	const wallet = {
		version: '1.0.0' as const,
		name: 'Revibase Dev Wallet',
		icon: ICON as WalletAccount['icon'] & `data:image/svg+xml;base64,${string}`,
		chains: CHAINS,
		get accounts() {
			return accounts;
		},
		features: {
			[StandardConnect]: {
				version: '1.0.0',
				connect: async () => {
					accounts = [account];
					for (const listener of listeners) listener({ accounts });
					return { accounts };
				}
			},
			[StandardDisconnect]: {
				version: '1.0.0',
				disconnect: async () => {
					accounts = [];
					for (const listener of listeners) listener({ accounts });
				}
			},
			[StandardEvents]: {
				version: '1.0.0',
				on: (event: string, listener: (event: { accounts: readonly WalletAccount[] }) => void) => {
					if (event !== 'change') return () => {};
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			},
			[SolanaSignMessage]: {
				version: '1.1.0',
				signMessage: async (...inputs: { account: WalletAccount; message: Uint8Array }[]) =>
					inputs.map(({ message }) => ({
						signedMessage: message,
						signature: ed25519.sign(message, key),
						signatureType: 'ed25519' as const
					}))
			},
			[SolanaSignTransaction]: {
				version: '1.0.0',
				supportedTransactionVersions: ['legacy', 0, 1] as const,
				signTransaction: async (...inputs: { account: WalletAccount; transaction: Uint8Array }[]) =>
					inputs.map(({ transaction }) => ({
						signedTransaction: signWireTransaction(transaction, address, key)
					}))
			}
		}
	};
	unregister = getWallets().register(wallet);
}

function encodeBase58(bytes: Uint8Array): string {
	const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);
	let output = '';
	while (value > 0n) {
		const remainder = Number(value % 58n);
		output = alphabet[remainder] + output;
		value /= 58n;
	}
	for (const byte of bytes) {
		if (byte !== 0) break;
		output = `1${output}`;
	}
	return output;
}
