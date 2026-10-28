import { afterEach, describe, expect, it } from 'vitest';

import {
	resolveApps,
	appsFileUrl,
	appDestination,
	MAX_APPS,
	type AppContext
} from '#lib/shared/project-apps.ts';
import { fetchAppsFile, loadApps } from '#lib/server/accessory/apps.ts';
import type { AccessoryView } from '#lib/shared/types.ts';

const MINT = 'So11111111111111111111111111111111111111112';
const COLLECTION = 'J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w';
const OWNER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const ACCESSORY = 'DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ';

const ctx: AppContext = {
	externalUrl: 'https://game.xyz',
	mint: MINT,
	collection: COLLECTION,
	owner: OWNER,
	accessory: ACCESSORY
};
const one = (app: Record<string, unknown>, c: AppContext = ctx) =>
	resolveApps({ version: 1, apps: [{ open: 'embed', ...app }] }, c);

describe('appsFileUrl', () => {
	it('appends /revibase.json to the external_url, keeping its path', () => {
		expect(appsFileUrl('https://game.xyz')).toBe('https://game.xyz/revibase.json');
		expect(appsFileUrl('https://game.xyz/')).toBe('https://game.xyz/revibase.json');
		expect(appsFileUrl('https://game.xyz/season-1/?ref=x#top')).toBe(
			'https://game.xyz/season-1/revibase.json'
		);
	});

	it('refuses anything but plain https', () => {
		expect(appsFileUrl('http://game.xyz')).toBeNull();
		expect(appsFileUrl('ipfs://bafy')).toBeNull();
		expect(appsFileUrl('https://user:pw@game.xyz')).toBeNull();
		expect(appsFileUrl('not a url')).toBeNull();
		expect(appsFileUrl(undefined)).toBeNull();
	});
});

describe('resolveApps (revibase.json)', () => {
	it('reads an app with defaults', () => {
		expect(one({ label: 'Stake', url: 'https://game.xyz/stake' })).toEqual([
			{
				label: 'Stake',
				href: 'https://game.xyz/stake',
				icon: null,
				open: 'embed'
			}
		]);
	});

	it('shows nothing for another version, or for a Phantom shortcuts file', () => {
		const apps = [{ label: 'Play', url: 'https://game.xyz', open: 'embed' }];
		expect(resolveApps({ apps }, ctx)).toEqual([]);
		expect(resolveApps({ version: 2, apps }, ctx)).toEqual([]);
		expect(
			resolveApps({ version: 2, shortcuts: [{ label: 'Play', uri: 'https://game.xyz' }] }, ctx)
		).toEqual([]);
	});

	it('fills the placeholders from the mint, collection, owner and accessory', () => {
		const [a] = one({
			label: 'Play',
			url: 'https://game.xyz/play/{{mint}}?c={{collection}}&o={{ owner }}&a={{accessory}}'
		});
		expect(a.href).toBe(`https://game.xyz/play/${MINT}?c=${COLLECTION}&o=${OWNER}&a=${ACCESSORY}`);
	});

	it('drops an app whose placeholder has no value, or is unknown', () => {
		expect(
			one({ label: 'Stake', url: 'https://game.xyz/{{owner}}' }, { ...ctx, owner: null })
		).toEqual([]);
		expect(
			one({ label: 'Stake', url: 'https://game.xyz/{{collection}}' }, { ...ctx, collection: null })
		).toEqual([]);
		expect(one({ label: 'Stake', url: 'https://game.xyz/{{tokenId}}' })).toEqual([]);
	});

	it('requires a known open mode', () => {
		expect(one({ label: 'Play', url: 'https://game.xyz', open: undefined })).toEqual([]);
		expect(one({ label: 'Play', url: 'https://game.xyz', open: 'wallet' })).toEqual([]);
	});

	it('embeds only the project host or its subdomains', () => {
		expect(one({ label: 'App', url: 'https://app.game.xyz/stake' })).toHaveLength(1);
		expect(one({ label: 'Evil', url: 'https://evil.test/stake' })).toEqual([]);
		expect(one({ label: 'Evil', url: 'https://game.xyz.evil.test/stake' })).toEqual([]);
		expect(one({ label: 'Chat', url: 'https://discord.gg/game', open: 'tab' })[0].open).toBe('tab');
	});

	it('allows https only', () => {
		const pay = `solana:${OWNER}?amount=0.1`;
		expect(one({ label: 'Tip', url: pay })).toEqual([]);
		expect(one({ label: 'Tip', url: pay, open: 'tab' })).toEqual([]);
		expect(one({ label: 'Tip', url: pay, open: 'pay' })).toEqual([]);
		expect(one({ label: 'Http', url: 'http://game.xyz/x' })).toEqual([]);
		expect(one({ label: 'Js', url: 'javascript:alert(1)', open: 'tab' })).toEqual([]);
		expect(one({ label: 'Creds', url: 'https://a:b@game.xyz/x' })).toEqual([]);
	});

	it('takes an https image link as the icon and drops anything else', () => {
		const [a] = one({
			label: 'Play',
			url: 'https://game.xyz',
			icon: 'https://cdn.game.xyz/icons/play.webp'
		});
		expect(a.icon).toBe('https://cdn.game.xyz/icons/play.webp');
		for (const bad of [
			'http://game.xyz/i.png',
			'data:image/png;base64,AAAA',
			'https://u:p@game.xyz/i.png',
			'gaming'
		]) {
			expect(one({ label: 'Play', url: 'https://game.xyz', icon: bad })[0].icon).toBeNull();
		}
	});

	it('clips labels, skips bad entries and caps the list', () => {
		expect(one({ label: 'x'.repeat(80), url: 'https://game.xyz' })[0].label).toHaveLength(32);
		const many = Array.from({ length: 12 }, (_, i) => ({
			label: `A${i}`,
			url: `https://game.xyz/${i}`,
			open: 'embed'
		}));
		const list = resolveApps({ version: 1, apps: [null, { label: '' }, 'x', ...many] }, ctx);
		expect(list).toHaveLength(MAX_APPS);
		expect(list[0].label).toBe('A0');
		expect(resolveApps({ version: 1, apps: 'nope' }, ctx)).toEqual([]);
		expect(resolveApps(null, ctx)).toEqual([]);
	});

	it('names the destination', () => {
		const list = resolveApps(
			{
				version: 1,
				apps: [
					{ label: 'A', url: 'https://www.game.xyz', open: 'embed' },
					{ label: 'B', url: 'https://discord.gg/game', open: 'tab' }
				]
			},
			ctx
		);
		expect(list.map(appDestination)).toEqual(['game.xyz', 'discord.gg']);
	});
});

describe('loading a project file', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	const accessory = { pda: 'pda', mint: MINT, owner: OWNER } as AccessoryView;

	function stub(routes: Record<string, () => Response>, seen: string[] = []) {
		globalThis.fetch = async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			seen.push(init?.method === 'POST' ? `DAS ${JSON.parse(String(init.body)).method}` : url);
			const route = routes[init?.method === 'POST' ? 'das' : url];
			return route ? route() : new Response('nope', { status: 404 });
		};
		return seen;
	}
	const das = (result: unknown) => () => Response.json({ jsonrpc: '2.0', id: 1, result });

	it.each(['bearer', 'controlled', 'permanent'] as const)(
		'loads minted %s token apps from DAS and the project file',
		async (kind) => {
			const seen = stub({
				das: das({
					content: { links: { external_url: 'https://game.xyz/s1' } },
					grouping: [{ group_key: 'collection', group_value: COLLECTION }]
				}),
				'https://game.xyz/s1/revibase.json': () =>
					Response.json({
						version: 1,
						apps: [
							{
								label: 'Play',
								url: 'https://game.xyz/{{mint}}',
								open: 'embed'
							}
						]
					})
			});
			const { externalUrl, apps } = await loadApps('https://rpc.test', { ...accessory, kind });
			expect(externalUrl).toBe('https://game.xyz/s1');
			expect(apps.map((a) => a.href)).toEqual([`https://game.xyz/${MINT}`]);
			expect(seen).toEqual(['DAS getAsset', 'https://game.xyz/s1/revibase.json']);
		}
	);

	it('has none without a mint or an https external_url, without asking the project', async () => {
		const seen = stub({ das: das({ content: { links: { external_url: 'http://game.xyz' } } }) });
		const none = { externalUrl: null, apps: [] };
		expect(await loadApps('https://rpc.test', { ...accessory, mint: null })).toEqual(none);
		expect(await loadApps('https://rpc.test', accessory)).toEqual(none);
		expect(seen).toEqual(['DAS getAsset']);
	});

	it('treats a missing, oversized or malformed file as no apps', async () => {
		stub({
			'https://a.test/revibase.json': () => new Response('not json'),
			'https://b.test/revibase.json': () => new Response('x'.repeat(70 * 1024)),
			'https://c.test/revibase.json': () =>
				new Response('{}', { headers: { 'content-length': String(1024 * 1024) } })
		});
		expect(await fetchAppsFile('https://a.test/revibase.json')).toBeNull();
		expect(await fetchAppsFile('https://b.test/revibase.json')).toBeNull();
		expect(await fetchAppsFile('https://c.test/revibase.json')).toBeNull();
		expect(await fetchAppsFile('https://missing.test/revibase.json')).toBeNull();
	});

	it('throws when DAS is unreachable, so the client retries', async () => {
		stub({ das: () => new Response('down', { status: 503 }) });
		await expect(loadApps('https://rpc.test', accessory)).rejects.toThrow();
	});
});
