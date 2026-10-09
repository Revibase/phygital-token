import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveShortcuts } from '$lib/shared/shortcuts';
import { walletDestinationLaunch, shortcutLaunch, walletLaunchHref } from '$lib/client/shortcuts';
import { KNOWN_WALLETS } from '$lib/client/wallet/catalog';
import { accessoryWalletApp, rememberAccessoryWalletApp, recentWallet, rememberRecentWallet } from '$lib/client/memory';
import { withFramingCheck } from '$lib/server/accessory/embed';

const origin = 'https://portal.revibase.com';
const context = { externalUrl: 'https://project.test', tokenId: 'So11111111111111111111111111111111111111112', collectionId: null, ownerAddress: null };
const shortcut = (mode: string, proof: boolean) => ({ ...resolveShortcuts({ shortcuts: [{ label: 'App', uri: 'https://provider.test/app', revibase: { launch: mode } }] }, context)[0], proof });
const environments = [
	{ name: 'desktop without wallet history', platform: 'desktop' as const, inWallet: false, recent: null },
	{ name: 'desktop with Phantom history', platform: 'desktop' as const, inWallet: false, recent: 'Phantom' },
	...(['ios', 'android'] as const).flatMap(platform => [
		{ name: `${platform} new browser`, platform, inWallet: false, recent: null },
		{ name: `${platform} unsupported recent wallet`, platform, inWallet: false, recent: 'Unknown' },
		...KNOWN_WALLETS.map(w => ({ name: `${platform} regular browser with ${w.name}`, platform, inWallet: false, recent: w.name })),
		{ name: `${platform} wallet browser without history`, platform, inWallet: true, recent: null },
		{ name: `${platform} wallet browser with different remembered app`, platform, inWallet: true, recent: 'Backpack' }
	])
];

afterEach(() => vi.unstubAllGlobals());

describe('shortcut launch scenario matrix', () => {
	for (const platform of ['desktop', 'ios', 'android'] as const) for (const recent of ['Phantom', 'Backpack', 'Solflare', 'Mobile Wallet Adapter']) for (const proof of [false, true]) {
		it(`${platform} detected ${recent}, proof ${proof}: browser connection opens a browser tab`, () => {
			expect(shortcutLaunch(shortcut('wallet', proof), { platform, recent, method: 'browser', inWallet: false, origin }, 2)).toEqual({kind: 'link', href: proof ? '/shortcut/2' : 'https://provider.test/app', newTab: true});
		});
	}
	it('current wallet browser overrides saved browser connection', () => {
		expect(shortcutLaunch(shortcut('wallet', true), { platform: 'ios', recent: 'Phantom', method: 'browser', inWallet: true, origin }, 2)).toEqual({kind: 'link', href: '/shortcut/2', newTab: false});
	});
	for (const env of environments) for (const proof of [false, true]) {
		const opts = { ...env, origin };
		it(`${env.name}, proofs ${proof ? 'on' : 'off'}: embed stays in our app`, () => {
			expect(shortcutLaunch(shortcut('embed', proof), opts, 2)).toEqual({ kind: 'link', href: '/accessory/app/2', newTab: false });
		});
		it(`${env.name}, proofs ${proof ? 'on' : 'off'}: browser avoids wallet handoff`, () => {
			expect(shortcutLaunch(shortcut('browser', proof), opts, 2)).toEqual({ kind: 'link', href: proof ? '/shortcut/2' : 'https://provider.test/app', newTab: true });
		});
		it(`${env.name}, proofs ${proof ? 'on' : 'off'}: wallet destination`, () => {
			const direct = proof ? '/shortcut/2' : 'https://provider.test/app';
			const wallet = KNOWN_WALLETS.find(w => w.name === env.recent);
			const expected = env.platform === 'desktop' ? { kind: 'link', href: direct, newTab: true }
				: env.inWallet ? { kind: 'link', href: direct, newTab: false }
				: wallet ? { kind: 'link', href: proof ? `/shortcut/2?wallet=${wallet.id}` : wallet.browse('https://provider.test/app', origin), newTab: false }
				: { kind: 'pick' };
			expect(shortcutLaunch(shortcut('wallet', proof), opts, 2)).toEqual(expected);
		});
	}
	it('framing refusal falls back to the wallet flow on a fresh phone', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { headers: { 'x-frame-options': 'DENY' } })));
		const [s] = await withFramingCheck([shortcut('embed', true)], origin);
		expect(s.immerse).toBe(false);
		expect(shortcutLaunch(s, { platform: 'ios', inWallet: false, recent: null, origin }, 2)).toEqual({ kind: 'pick' });
	});
	it('each picker app carries the proof route into its own wallet browser', () => {
		for (const wallet of KNOWN_WALLETS) expect(walletLaunchHref(shortcut('wallet', true), 2, wallet, origin)).toBe(`/shortcut/2?wallet=${wallet.id}`);
	});
});

describe('linking device versus clicking browser', () => {
	it('Safari that observes remote Phantom completion remembers it; a new browser does not', () => {
		let values = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
		// Same persistence called when the originating browser observes confirmed remote completion.
		rememberAccessoryWalletApp('card', 'owner', 'Phantom');
		rememberRecentWallet('Phantom');
		const opts = { platform: 'ios' as const, inWallet: false, origin, recent: accessoryWalletApp('card', 'owner') ?? recentWallet() };
		expect(shortcutLaunch(shortcut('wallet', true), opts, 2)).toEqual({ kind: 'link', href: '/shortcut/2?wallet=phantom', newTab: false });
		values = new Map();
		expect(shortcutLaunch(shortcut('wallet', true), { ...opts, recent: accessoryWalletApp('card', 'owner') ?? recentWallet() }, 2)).toEqual({ kind: 'pick' });
	});
});

describe('shared wallet action routing', () => {
	const url = origin + '/unlink/card';
	it('routes unlink to the remembered wallet app', () => {
		expect(walletDestinationLaunch(url, {platform:'ios',inWallet:false,recent:'Phantom',method:'wallet',origin})).toEqual({kind:'link',href:KNOWN_WALLETS[0].browse(url,origin),newTab:false});
	});
	it('keeps browser connections and wallet browsers on direct URLs', () => {
		expect(walletDestinationLaunch(url,{platform:'android',inWallet:false,recent:'Phantom',method:'browser',origin})).toEqual({kind:'link',href:url,newTab:true});
		expect(walletDestinationLaunch(url,{platform:'ios',inWallet:true,recent:'Backpack',origin})).toEqual({kind:'link',href:url,newTab:false});
	});
	it('asks for a wallet on a new device', () => {
		expect(walletDestinationLaunch(url,{platform:'ios',inWallet:false,recent:null,origin})).toEqual({kind:'pick'});
	});
});
