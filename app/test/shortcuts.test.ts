import { afterEach, describe, expect, it } from 'vitest';

import { resolveShortcuts, shortcutsFileUrl, shortcutsFor, shortcutDestination, MAX_SHORTCUTS, type ShortcutContext } from '$lib/shared/shortcuts';
import { fetchShortcutsFile, loadShortcuts } from '$lib/server/accessory/shortcuts';
import { walletDestinationLaunch, shortcutLaunch, walletLaunchHref } from '$lib/client/shortcuts';
import { KNOWN_WALLETS } from '$lib/client/wallet/catalog';
import type { AccessoryView } from '$lib/shared/types';

const MINT = 'So11111111111111111111111111111111111111112';
const COLLECTION = 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const ctx: ShortcutContext = { externalUrl: 'https://game.xyz', tokenId: MINT, collectionId: COLLECTION, ownerAddress: OWNER };
const one = (shortcut: Record<string, unknown>, c: ShortcutContext = ctx) => resolveShortcuts({ version: 2, shortcuts: [shortcut] }, c);

describe('shortcutsFileUrl', () => {
	it('appends /shortcuts.json to the external_url, keeping its path', () => {
		expect(shortcutsFileUrl('https://game.xyz')).toBe('https://game.xyz/shortcuts.json');
		expect(shortcutsFileUrl('https://game.xyz/')).toBe('https://game.xyz/shortcuts.json');
		expect(shortcutsFileUrl('https://game.xyz/season-1/?ref=x#top')).toBe('https://game.xyz/season-1/shortcuts.json');
	});

	it('refuses anything but plain https', () => {
		expect(shortcutsFileUrl('http://game.xyz')).toBeNull();
		expect(shortcutsFileUrl('ipfs://bafy')).toBeNull();
		expect(shortcutsFileUrl('https://user:pw@game.xyz')).toBeNull();
		expect(shortcutsFileUrl('not a url')).toBeNull();
		expect(shortcutsFileUrl(undefined)).toBeNull();
	});
});

describe('resolveShortcuts (Phantom shortcuts.json)', () => {
	it('reads a Phantom file unchanged, with defaults', () => {
		expect(one({ label: 'Stake', uri: 'https://game.xyz/stake', icon: 'stake' })).toEqual([
			{ label: 'Stake', href: 'https://game.xyz/stake', icon: 'stake', image: null, immerse: false, proof: false, external: false, platform: 'all' }
		]);
	});

	it('fills the three placeholders from the mint, collection and linked wallet', () => {
		const [s] = one({ label: 'Play', uri: 'https://game.xyz/play/{{tokenId}}?c={{collectionId}}&o={{ ownerAddress }}' });
		expect(s.href).toBe(`https://game.xyz/play/${MINT}?c=${COLLECTION}&o=${OWNER}`);
	});

	it('drops a shortcut whose placeholder has no value, or is unknown', () => {
		expect(one({ label: 'Stake', uri: 'https://game.xyz/{{ownerAddress}}' }, { ...ctx, ownerAddress: null })).toEqual([]);
		expect(one({ label: 'Stake', uri: 'https://game.xyz/{{collectionId}}' }, { ...ctx, collectionId: null })).toEqual([]);
		expect(one({ label: 'Stake', uri: 'https://game.xyz/{{secret}}' })).toEqual([]);
	});

	it('keeps wallet shortcuts on the project host or its subdomains (Phantom rule)', () => {
		expect(one({ label: 'App', uri: 'https://app.game.xyz/stake' })).toHaveLength(1);
		expect(one({ label: 'Evil', uri: 'https://evil.test/stake' })).toEqual([]);
		expect(one({ label: 'Evil', uri: 'https://game.xyz.evil.test/stake' })).toEqual([]);
		expect(one({ label: 'Chat', uri: 'https://discord.gg/game', prefersExternalTarget: true })[0].external).toBe(true);
	});

	it('allows https and, for external shortcuts only, Solana Pay', () => {
		const pay = `solana:${OWNER}?amount=0.1`;
		expect(one({ label: 'Tip', uri: pay, prefersExternalTarget: true })[0].href).toBe(pay);
		expect(one({ label: 'Tip', uri: pay })).toEqual([]);
		expect(one({ label: 'Http', uri: 'http://game.xyz/x' })).toEqual([]);
		expect(one({ label: 'Js', uri: 'javascript:alert(1)', prefersExternalTarget: true })).toEqual([]);
		expect(one({ label: 'Creds', uri: 'https://a:b@game.xyz/x' })).toEqual([]);
	});

	it('honours type, platform and limitToCollections', () => {
		expect(one({ label: 'Swap', uri: 'https://game.xyz', type: 'fungible' })).toEqual([]);
		expect(one({ label: 'Play', uri: 'https://game.xyz', platform: 'mobile' })[0].platform).toBe('mobile');
		expect(one({ label: 'Play', uri: 'https://game.xyz', platform: 'watch' })).toEqual([]);
		expect(one({ label: 'Mine', uri: 'https://game.xyz', limitToCollections: [COLLECTION] })).toHaveLength(1);
		expect(one({ label: 'Other', uri: 'https://game.xyz', limitToCollections: [MINT] })).toEqual([]);
		expect(one({ label: 'Other', uri: 'https://game.xyz', limitToCollections: [COLLECTION] }, { ...ctx, collectionId: null })).toEqual([]);
	});

	it('takes an https image link as the icon, with a glyph to fall back on', () => {
		const [s] = one({ label: 'Play', uri: 'https://game.xyz', icon: 'https://cdn.game.xyz/icons/play.webp' });
		expect(s).toMatchObject({ icon: 'generic-link', image: 'https://cdn.game.xyz/icons/play.webp' });
		expect(one({ label: 'Play', uri: 'https://game.xyz', icon: 'gaming' })[0].image).toBeNull();
		for (const bad of ['http://game.xyz/i.png', 'data:image/png;base64,AAAA', 'https://u:p@game.xyz/i.png', 'rocket']) {
			expect(one({ label: 'Play', uri: 'https://game.xyz', icon: bad })[0]).toMatchObject({ icon: 'generic-link', image: null });
		}
	});

	it('embeds only when the project writes preferredPresentation: "immerse" on a wallet shortcut', () => {
		expect(one({ label: 'Play', uri: 'https://game.xyz/play', preferredPresentation: 'immerse' })[0].immerse).toBe(true);
		expect(one({ label: 'Play', uri: 'https://game.xyz/play' })[0].immerse).toBe(false); // Phantom's default doesn't count
		expect(one({ label: 'Play', uri: 'https://game.xyz/play', preferredPresentation: 'default' })[0].immerse).toBe(false);
		expect(one({ label: 'Chat', uri: 'https://discord.gg/x', prefersExternalTarget: true, preferredPresentation: 'immerse' })[0].immerse).toBe(false);
	});

	it('falls back to a generic icon, clips labels, skips bad entries and caps the list', () => {
		expect(one({ label: 'Go', uri: 'https://game.xyz', icon: 'rocket' })[0].icon).toBe('generic-link');
		expect(one({ label: 'x'.repeat(80), uri: 'https://game.xyz' })[0].label).toHaveLength(32);
		const many = Array.from({ length: 12 }, (_, i) => ({ label: `S${i}`, uri: `https://game.xyz/${i}` }));
		const list = resolveShortcuts({ shortcuts: [null, { label: '' }, 'x', ...many] }, ctx);
		expect(list).toHaveLength(MAX_SHORTCUTS);
		expect(list[0].label).toBe('S0');
		expect(resolveShortcuts({ shortcuts: 'nope' }, ctx)).toEqual([]);
		expect(resolveShortcuts(null, ctx)).toEqual([]);
	});

	it('filters by device and names the destination', () => {
		const list = resolveShortcuts(
			{ shortcuts: [{ label: 'A', uri: 'https://www.game.xyz', platform: 'desktop' }, { label: 'B', uri: `solana:${OWNER}`, prefersExternalTarget: true, platform: 'mobile' }] },
			ctx
		);
		expect(shortcutsFor(list, 'desktop').map((s) => s.label)).toEqual(['A']);
		expect(shortcutsFor(list, 'mobile').map((s) => s.label)).toEqual(['B']);
		expect(list.map(shortcutDestination)).toEqual(['game.xyz', 'Solana Pay']);
	});
});

describe('shortcutLaunch', () => {
	const wallet = one({ label: 'Play', uri: 'https://game.xyz/play' })[0];
	const site = one({ label: 'Chat', uri: 'https://discord.gg/x', prefersExternalTarget: true })[0];
	const base = { platform: 'ios' as const, inWallet: false, recent: null, origin: 'https://app.revibase.com' };

	it('opens an embedded shortcut on its launch page, wherever the viewer is', () => {
		const framed = { ...wallet, immerse: true };
		for (const opts of [base, { ...base, platform: 'desktop' as const }, { ...base, inWallet: true }, { ...base, recent: 'Phantom' }]) {
			expect(shortcutLaunch(framed, opts, 3)).toEqual({ kind: 'link', href: '/accessory/app/3', newTab: false });
		}
	});

	it('sends shortcuts that carry a proof through /shortcut/[n], so it is minted on open', () => {
		const proven = { ...wallet, proof: true };
		expect(shortcutLaunch(proven, { ...base, platform: 'desktop' }, 2)).toEqual({ kind: 'link', href: '/shortcut/2', newTab: true });
		expect(shortcutLaunch(proven, { ...base, inWallet: true }, 2)).toEqual({ kind: 'link', href: '/shortcut/2', newTab: false });
		expect(shortcutLaunch(proven, { ...base, recent: 'Backpack' }, 2)).toEqual({ kind: 'link', href: '/shortcut/2?wallet=backpack', newTab: false });
		expect(shortcutLaunch({ ...site, proof: true }, base, 5)).toEqual({ kind: 'link', href: '/shortcut/5', newTab: true });
		const phantom = KNOWN_WALLETS[0];
		expect(walletLaunchHref(proven, 2, phantom, base.origin)).toBe('/shortcut/2?wallet=phantom');
		expect(walletLaunchHref(wallet, 2, phantom, base.origin)).toBe(phantom.browse(wallet.href, base.origin));
	});

	it('opens external links as plain links', () => {
		expect(shortcutLaunch(site, base, 0)).toEqual({ kind: 'link', href: 'https://discord.gg/x', newTab: true });
	});

	it('opens wallet shortcuts in a tab on computers and in place inside a wallet browser', () => {
		expect(shortcutLaunch(wallet, { ...base, platform: 'desktop' }, 0)).toEqual({ kind: 'link', href: 'https://game.xyz/play', newTab: true });
		expect(shortcutLaunch(wallet, { ...base, inWallet: true }, 0)).toEqual({ kind: 'link', href: 'https://game.xyz/play', newTab: false });
	});

	it('hands a phone browser to the recent wallet, or asks which one', () => {
		expect(shortcutLaunch(wallet, { ...base, recent: 'Phantom' }, 0)).toEqual({
			kind: 'link',
			href: `https://phantom.app/ul/browse/${encodeURIComponent('https://game.xyz/play')}?ref=${encodeURIComponent(base.origin)}`,
			newTab: false
		});
		expect(shortcutLaunch(wallet, base, 0)).toEqual({ kind: 'pick' });
		expect(shortcutLaunch(wallet, { ...base, recent: 'Some Other Wallet' }, 0)).toEqual({ kind: 'pick' });
	});
});

describe('loading a project file', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const accessory = { pda: 'pda', mint: MINT, linkedWallet: OWNER } as AccessoryView;

	function stub(routes: Record<string, () => Response>, seen: string[] = []) {
		globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			seen.push(init?.method === 'POST' ? `DAS ${JSON.parse(String(init.body)).method}` : url);
			const route = routes[init?.method === 'POST' ? 'das' : url];
			return route ? route() : new Response('nope', { status: 404 });
		}) as typeof fetch;
		return seen;
	}
	const das = (result: unknown) => () => Response.json({ jsonrpc: '2.0', id: 1, result });

	it.each(['bearer', 'controlled', 'permanent'] as const)('loads minted %s token shortcuts from DAS and the project file', async (kind) => {
		const seen = stub({
			das: das({ content: { links: { external_url: 'https://game.xyz/s1' } }, grouping: [{ group_key: 'collection', group_value: COLLECTION }] }),
			'https://game.xyz/s1/shortcuts.json': () =>
				Response.json({ version: 2, shortcuts: [{ label: 'Play', uri: 'https://game.xyz/{{tokenId}}', limitToCollections: [COLLECTION] }] })
		});
		const { externalUrl, shortcuts } = await loadShortcuts('https://rpc.test', { ...accessory, kind });
		expect(externalUrl).toBe('https://game.xyz/s1');
		expect(shortcuts.map((s) => s.href)).toEqual([`https://game.xyz/${MINT}`]);
		expect(seen).toEqual(['DAS getAsset', 'https://game.xyz/s1/shortcuts.json']);
	});

	it('has none without a mint or an https external_url, without asking the project', async () => {
		const seen = stub({ das: das({ content: { links: { external_url: 'http://game.xyz' } } }) });
		const none = { externalUrl: null, shortcuts: [] };
		expect(await loadShortcuts('https://rpc.test', { ...accessory, mint: null })).toEqual(none);
		expect(await loadShortcuts('https://rpc.test', accessory)).toEqual(none);
		expect(seen).toEqual(['DAS getAsset']);
	});

	it('treats a missing, oversized or malformed file as no shortcuts', async () => {
		stub({
			'https://a.test/shortcuts.json': () => new Response('not json'),
			'https://b.test/shortcuts.json': () => new Response('x'.repeat(70 * 1024)),
			'https://c.test/shortcuts.json': () => new Response('{}', { headers: { 'content-length': String(1024 * 1024) } })
		});
		expect(await fetchShortcutsFile('https://a.test/shortcuts.json')).toBeNull();
		expect(await fetchShortcutsFile('https://b.test/shortcuts.json')).toBeNull();
		expect(await fetchShortcutsFile('https://c.test/shortcuts.json')).toBeNull();
		expect(await fetchShortcutsFile('https://missing.test/shortcuts.json')).toBeNull();
	});

	it('throws when DAS is unreachable, so the client retries', async () => {
		stub({ das: () => new Response('down', { status: 503 }) });
		await expect(loadShortcuts('https://rpc.test', accessory)).rejects.toThrow();
	});
});

describe('Revibase launch modes', () => {
	it('asks on desktop and mobile after forgetting preferences, while staying in wallet browsers', () => {
		for (const platform of ['desktop', 'ios', 'android'] as const) {
			const opts = { platform, inWallet:false, chooseWallet:true, recent:'Phantom', method:'wallet' as const, origin:'https://revibase.test' };
			expect(walletDestinationLaunch('/unlink/token',opts)).toEqual({kind:'pick'});
		}
		expect(walletDestinationLaunch('/unlink/token',{platform:'ios',inWallet:true,chooseWallet:true,recent:null,origin:'https://revibase.test'})).toEqual({kind:'link',href:'/unlink/token',newTab:false});
	});

	it('allows third-party wallet destinations and overrides Phantom fields', () => {
		const [s] = one({
			label: 'Stake',
			uri: 'https://staking.test/app',
			prefersExternalTarget: true,
			preferredPresentation: 'immerse',
			revibase: { launch: 'wallet' }
		});
		expect(s).toMatchObject({ external: false, immerse: false });
		expect(
			shortcutLaunch(
				s,
				{
					platform: 'ios',
					inWallet: false,
					recent: 'Phantom',
					origin: 'https://portal.revibase.com'
				},
				0
			)
		).toMatchObject({
			href: KNOWN_WALLETS[0].browse(s.href, 'https://portal.revibase.com'),
			newTab: false
		});
	});
	it('allows explicit embedding and browser launches on any HTTPS domain', () => {
		expect(
			one({
				label: 'Play',
				uri: 'https://other.test',
				revibase: { launch: 'embed' }
			})[0]
		).toMatchObject({ immerse: true, external: false });
		expect(
			one({
				label: 'Visit',
				uri: 'https://other.test',
				revibase: { launch: 'browser' }
			})[0]
		).toMatchObject({ immerse: false, external: true });
	});
	it('rejects malformed launch settings and refuses Solana URIs except browser launches', () => {
		for (const revibase of [null, [], 'wallet', {}, { launch: 'invalid' }]) expect(one({ label: 'Go', uri: 'https://game.xyz', revibase })).toEqual([]);
		expect(
			one({
				label: 'Pay',
				uri: `solana:${OWNER}`,
				revibase: { launch: 'wallet' }
			})
		).toEqual([]);
		expect(
			one({
				label: 'Pay',
				uri: `solana:${OWNER}`,
				revibase: { launch: 'browser' }
			})
		).toHaveLength(1);
	});
});
