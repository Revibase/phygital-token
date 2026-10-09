import { rememberWallet, rememberAccessoryLink, rememberAccessoryWalletApp, rememberRecentWallet } from '$lib/client/memory';
// Test-only wallet boundary. Production pages and their controls remain unchanged.
let account = $state<string | null>(null);
let available = $state(false);
export const walletStore = {
	init() {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (url.searchParams.get('savedWallet') === 'phantom') {
			const pda = 'So11111111111111111111111111111111111111112';
			const wallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
			rememberWallet(pda, wallet);
			rememberRecentWallet('Phantom', 'wallet');
			rememberAccessoryWalletApp(pda, wallet, 'Phantom', 'wallet');
			rememberAccessoryLink(pda, { wallet, app: 'Phantom', source: 'desktop' });
			url.searchParams.delete('savedWallet');
			window.history.replaceState(window.history.state, '', url);
		}
		available = /Phantom/i.test(navigator.userAgent) || localStorage.getItem('simulation:browser-wallet') === 'true';
		window.addEventListener('simulation:account', ((e: CustomEvent) => {
			account = e.detail;
		}) as EventListener);
	},
	get options() {
		return available ? [{ id: 'phantom', name: 'Phantom', icon: '/wallets/phantom.svg', ready: true }] : [];
	},
	get address() {
		return account;
	},
	get status() {
		return account ? 'connected' : 'disconnected';
	},
	get walletName() {
		return account ? 'Phantom' : null;
	},
	get walletIcon() {
		return account ? '/wallets/phantom.svg' : null;
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
	signingContext() {
		return { address: account, wallet: { name: 'Phantom' } };
	}
};
export async function signWithWallet() {
	throw new Error('Signing must be simulated explicitly');
}
