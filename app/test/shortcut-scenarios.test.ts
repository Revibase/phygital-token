import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveShortcuts } from '$lib/shared/shortcuts';
import { walletDestinationLaunch, shortcutLaunch } from '$lib/client/shortcuts';
import { KNOWN_WALLETS } from '$lib/client/wallet/catalog';
import {
	accessoryWalletApp,
	rememberAccessoryWalletApp,
	recentWallet,
	rememberRecentWallet
} from '$lib/client/memory';

const origin = 'https://portal.revibase.com';
const APP = 'https://provider.test/app';
const context = {
	externalUrl: 'https://project.test',
	tokenId: 'So11111111111111111111111111111111111111112',
	collectionId: null,
	ownerAddress: null
};
const shortcut = (mode: string) =>
	resolveShortcuts(
		{ shortcuts: [{ label: 'App', uri: APP, revibase: { launch: mode } }] },
		context
	)[0];
const environments = [
	{
		name: 'desktop without wallet history',
		platform: 'desktop' as const,
		inWallet: false,
		recent: null
	},
	{
		name: 'desktop with Phantom history',
		platform: 'desktop' as const,
		inWallet: false,
		recent: 'Phantom'
	},
	...(['ios', 'android'] as const).flatMap((platform) => [
		{ name: `${platform} new browser`, platform, inWallet: false, recent: null },
		{ name: `${platform} unsupported recent wallet`, platform, inWallet: false, recent: 'Unknown' },
		...KNOWN_WALLETS.map((w) => ({
			name: `${platform} regular browser with ${w.name}`,
			platform,
			inWallet: false,
			recent: w.name
		})),
		{ name: `${platform} wallet browser`, platform, inWallet: true, recent: 'Backpack' }
	])
];

afterEach(() => vi.unstubAllGlobals());

describe('shortcut launch scenario matrix', () => {
	it('a browser connection opens wallet shortcuts in a browser tab', () => {
		expect(
			shortcutLaunch(shortcut('wallet'), {
				platform: 'ios',
				recent: 'Phantom',
				method: 'browser',
				inWallet: false,
				origin
			})
		).toEqual({ kind: 'link', href: APP, newTab: true });
	});
	for (const env of environments) {
		const opts = { ...env, origin };
		it(`${env.name}: browser avoids the wallet handoff`, () => {
			expect(shortcutLaunch(shortcut('browser'), opts)).toEqual({
				kind: 'link',
				href: APP,
				newTab: true
			});
		});
		for (const mode of ['wallet', 'embed']) {
			it(`${env.name}: ${mode} opens in a wallet`, () => {
				const wallet = KNOWN_WALLETS.find((w) => w.name === env.recent);
				const expected =
					env.platform === 'desktop'
						? { kind: 'link', href: APP, newTab: true }
						: env.inWallet
							? { kind: 'link', href: APP, newTab: false }
							: wallet
								? { kind: 'link', href: wallet.browse(APP, origin), newTab: false }
								: { kind: 'pick' };
				expect(shortcutLaunch(shortcut(mode), opts)).toEqual(expected);
			});
		}
	}
});

describe('claiming device versus clicking browser', () => {
	it('Safari that saw a Phantom claim finish remembers it; a new browser does not', () => {
		let values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => values.get(k) ?? null,
			setItem: (k: string, v: string) => values.set(k, v),
			removeItem: (k: string) => values.delete(k)
		});
		rememberAccessoryWalletApp('card', 'owner', 'Phantom');
		rememberRecentWallet('Phantom');
		const opts = {
			platform: 'ios' as const,
			inWallet: false,
			origin,
			recent: accessoryWalletApp('card', 'owner') ?? recentWallet()
		};
		expect(shortcutLaunch(shortcut('wallet'), opts)).toEqual({
			kind: 'link',
			href: KNOWN_WALLETS[0].browse(APP, origin),
			newTab: false
		});
		values = new Map();
		expect(
			shortcutLaunch(shortcut('wallet'), {
				...opts,
				recent: accessoryWalletApp('card', 'owner') ?? recentWallet()
			})
		).toEqual({ kind: 'pick' });
	});
});

describe('shared wallet action routing', () => {
	const url = origin + '/unlink/card';
	it('routes release to the remembered wallet app', () => {
		expect(
			walletDestinationLaunch(url, {
				platform: 'ios',
				inWallet: false,
				recent: 'Phantom',
				method: 'wallet',
				origin
			})
		).toEqual({ kind: 'link', href: KNOWN_WALLETS[0].browse(url, origin), newTab: false });
	});
	it('keeps browser connections and wallet browsers on direct URLs', () => {
		expect(
			walletDestinationLaunch(url, {
				platform: 'android',
				inWallet: false,
				recent: 'Phantom',
				method: 'browser',
				origin
			})
		).toEqual({ kind: 'link', href: url, newTab: true });
		expect(
			walletDestinationLaunch(url, { platform: 'ios', inWallet: true, recent: 'Backpack', origin })
		).toEqual({ kind: 'link', href: url, newTab: false });
	});
	it('asks for a wallet on a new device', () => {
		expect(
			walletDestinationLaunch(url, { platform: 'ios', inWallet: false, recent: null, origin })
		).toEqual({ kind: 'pick' });
	});
});
