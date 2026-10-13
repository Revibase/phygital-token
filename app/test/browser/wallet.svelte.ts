import { rememberWallet, rememberRecentWallet } from '$lib/client/memory';
// Test-only wallet boundary. Production pages and their controls remain unchanged.
let account = $state<string | null>(null);
let available = $state(false);
// `localStorage['simulation:wallet'] = 'passkey'` previews the Revibase Passkey wallet instead of Phantom.
let passkey = $state(false);
export const walletStore = {
	init() {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (url.searchParams.get('savedWallet') === 'phantom') {
			const pda = 'So11111111111111111111111111111111111111112';
			const wallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
			rememberWallet(pda, wallet);
			rememberRecentWallet('Phantom');
			url.searchParams.delete('savedWallet');
			window.history.replaceState(window.history.state, '', url);
		}
		available =
			/Phantom/i.test(navigator.userAgent) ||
			localStorage.getItem('simulation:browser-wallet') === 'true';
		passkey = localStorage.getItem('simulation:wallet') === 'passkey';
		window.addEventListener('simulation:account', ((e: CustomEvent) => {
			account = e.detail;
		}) as EventListener);
	},
	get options() {
		return available
			? [{ id: 'phantom', name: 'Phantom', icon: '/icon-192.png', ready: true }]
			: [];
	},
	get address() {
		return account;
	},
	get status() {
		return account ? 'connected' : 'disconnected';
	},
	get walletName() {
		return account ? (passkey ? 'Revibase Passkey' : 'Phantom') : null;
	},
	get walletIcon() {
		return account ? '/icon-192.png' : null;
	},
	get error() {
		return null;
	},
	async connect() {
		account = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
	},
	async disconnect() {
		account = null;
	},
	get approvePrompt() {
		return `Approve in ${passkey ? 'Revibase Passkey' : 'Phantom'}…`;
	},
	signingContext() {
		return { address: account, wallet: { name: passkey ? 'Revibase Passkey' : 'Phantom' } };
	}
};
export async function signWithWallet() {
	throw new Error('Signing must be simulated explicitly');
}
export async function signMessageWithWallet() {
	throw new Error('Signing must be simulated explicitly');
}
