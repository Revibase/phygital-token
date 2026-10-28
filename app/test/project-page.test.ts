import { describe, expect, it } from 'vitest';

import { iconProxyPath } from '#lib/server/accessory/app-icons.ts';
import { withPageProxy } from '#lib/server/accessory/apps.ts';
import { assetImagePath, verifyAssetImageUrl } from '#lib/server/media/asset-images.ts';
import { resolveApps, type AppContext } from '#lib/shared/project-apps.ts';
import {
	EMPTY_PAGE,
	MAX_TEXT,
	MAX_TITLE,
	contrast,
	foregroundFor,
	mainButton,
	pickFeatured,
	resolvePage
} from '#lib/shared/project-page.ts';

const MINT = 'So11111111111111111111111111111111111111112';
const SECRET = 'x'.repeat(32);
const ctx: AppContext = {
	externalUrl: 'https://game.xyz/s2',
	mint: MINT,
	collection: null,
	owner: null,
	accessory: 'DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ'
};
const APPS = [
	{
		label: 'Play',
		url: 'https://play.game.xyz/?mint={{mint}}',
		open: 'embed',
		icon: 'https://game.xyz/play.png'
	},
	{ label: 'Market', url: 'https://market.example/x', open: 'tab' },
	{ label: 'Verify wallet', url: 'https://game.xyz/v', open: 'embed' }
];
const IMAGE = 'https://game.xyz/featured.jpg';
const page = (file: Record<string, unknown>) =>
	resolvePage({ version: 1, apps: APPS, ...file }, ctx);
const one = (entry: unknown) => page({ featured: { default: entry } }).featured.default;

describe('resolvePage', () => {
	it('reads a file with only apps exactly as before', () => {
		const file = { version: 1, apps: APPS };
		expect(resolvePage(file, ctx)).toEqual({
			...EMPTY_PAGE,
			host: 'game.xyz',
			apps: resolveApps(file, ctx)
		});
	});

	it('shows nothing for another version, but still names the host', () => {
		expect(
			resolvePage({ version: 2, apps: APPS, featured: { default: { title: 'x' } } }, ctx)
		).toEqual({ ...EMPTY_PAGE, host: 'game.xyz' });
		expect(resolvePage(null, ctx)).toEqual({ ...EMPTY_PAGE, host: 'game.xyz' });
	});

	it('reads an entry, clipping the words and naming its button by app label', () => {
		expect(
			one({ image: IMAGE, title: 't'.repeat(80), text: ` ${'s'.repeat(80)} `, button: ' Play ' })
		).toEqual({
			image: IMAGE,
			title: 't'.repeat(MAX_TITLE),
			text: 's'.repeat(MAX_TEXT),
			button: {
				label: 'Play',
				href: `https://play.game.xyz/?mint=${MINT}`,
				open: 'embed',
				// The button shows no icon, so the project's icon URL isn't passed along.
				icon: null
			}
		});
	});

	it('needs a title; a bad image or a button naming no app only drops that part', () => {
		expect(one({ image: IMAGE })).toBeUndefined();
		expect(one({ title: ' ' })).toBeUndefined();
		expect(one('Welcome')).toBeUndefined();
		expect(one({ title: 'Hi', image: 'http://game.xyz/a.png' })).toEqual({
			image: null,
			title: 'Hi',
			text: null,
			button: null
		});
		for (const button of ['Shop', 'play', { label: 'Play' }, 'https://play.game.xyz']) {
			expect(one({ title: 'Hi', button })?.button).toBeNull();
		}
		expect(one({ title: 'Hi', image: 'ipfs://bafy/f.png' })?.image).toBe(
			'https://ipfs.io/ipfs/bafy/f.png'
		);
	});

	it('reads only the four known keys', () => {
		const p = page({
			featured: {
				default: { title: 'D' },
				unclaimed: { title: 'U' },
				owner: { title: 'O' },
				visitor: { title: 'V' },
				admin: { title: 'A' }
			}
		});
		expect(Object.keys(p.featured).sort()).toEqual(['default', 'owner', 'unclaimed', 'visitor']);
		expect(page({ featured: [{ title: 'list' }] }).featured).toEqual({});
	});

	it('reads the accent and a color or image background', () => {
		expect(page({ style: { accent: '#FF5A1F', background: '#1B1446' } }).style).toEqual({
			accent: { color: '#ff5a1f', foreground: '#0e1a1a' },
			background: { kind: 'color', color: '#1b1446', scheme: 'dark' }
		});
		expect(page({ style: { background: '#FCE7EC' } }).style.background).toEqual({
			kind: 'color',
			color: '#fce7ec',
			scheme: 'light'
		});
		expect(page({ style: { background: IMAGE } }).style.background).toEqual({
			kind: 'image',
			image: IMAGE
		});
	});

	it('ignores anything else in style', () => {
		for (const style of [
			{ accent: 'red', background: 'blue' },
			{ accent: '#fff', background: 'http://game.xyz/bg.png' },
			{ accent: '#ff5a1f; x:url(y)', background: 'url(https://game.xyz/bg.png)' },
			'dark',
			null
		]) {
			expect(page({ style }).style).toEqual({ accent: null, background: null });
		}
	});
});

describe('foregroundFor', () => {
	it('always gives at least AA large-text contrast', () => {
		for (const c of ['#000000', '#ffffff', '#ff0000', '#00c2b8', '#7f7f7f', '#ffcc00', '#4b0082']) {
			expect(contrast(c, foregroundFor(c))).toBeGreaterThanOrEqual(4.3);
		}
	});
});

describe('picking what shows', () => {
	const p = page({
		featured: {
			default: { title: 'everyone', button: 'Market' },
			unclaimed: { title: 'unbox' },
			owner: { title: 'season', button: 'Play' }
		}
	});
	const [play] = p.apps;

	it("takes the audience's entry, else default", () => {
		expect(pickFeatured(p.featured, 'unclaimed')?.title).toBe('unbox');
		expect(pickFeatured(p.featured, 'owner')?.title).toBe('season');
		expect(pickFeatured(p.featured, 'visitor')?.title).toBe('everyone');
		expect(pickFeatured({}, 'visitor')).toBeNull();
	});

	it('makes Claim the main button whenever the viewer can claim', () => {
		expect(mainButton(pickFeatured(p.featured, 'owner'), true)).toEqual({ kind: 'claim' });
		expect(mainButton(null, true)).toEqual({ kind: 'claim' });
	});

	it("otherwise uses the entry's app, or none", () => {
		expect(mainButton(pickFeatured(p.featured, 'owner'), false)).toEqual({
			kind: 'app',
			app: { ...play, icon: null }
		});
		expect(mainButton(pickFeatured(p.featured, 'unclaimed'), false)).toBeNull();
		expect(mainButton(null, false)).toBeNull();
	});

	it("shows a main button that reads like a Revibase flow as 'Open'", () => {
		const q = page({ featured: { default: { title: 'x', button: 'Verify wallet' } } });
		const main = mainButton(q.featured.default!, false);
		expect(main?.kind === 'app' && main.app.label).toBe('Open');
		// The app row keeps the project's own label.
		expect(q.apps[2].label).toBe('Verify wallet');
	});
});

describe('withPageProxy', () => {
	it('serves every page image from our origin, signed', async () => {
		const p = page({
			style: { background: 'https://game.xyz/bg.png' },
			featured: { owner: { image: IMAGE, title: 'x', button: 'Play' }, default: { title: 'y' } }
		});
		const proxied = await withPageProxy(p, SECRET);
		expect(proxied.style.background).toEqual({
			kind: 'image',
			image: await assetImagePath(SECRET, 'https://game.xyz/bg.png')
		});
		expect(proxied.featured.owner?.image).toBe(await assetImagePath(SECRET, IMAGE));
		expect(proxied.featured.default?.image).toBeNull();
		expect(proxied.apps[0].icon).toBe(await iconProxyPath(SECRET, 'https://game.xyz/play.png'));

		const signed = new URL(proxied.featured.owner!.image!, 'https://portal.test');
		expect(
			await verifyAssetImageUrl(SECRET, signed.searchParams.get('u'), signed.searchParams.get('s'))
		).toBe(true);
		expect(JSON.stringify(proxied)).not.toMatch(/"https:\/\/game\.xyz\/(featured|bg|play)\./);
	});

	it('leaves a color background as it is', async () => {
		const p = page({ style: { background: '#1b1446' } });
		expect((await withPageProxy(p, SECRET)).style).toEqual(p.style);
	});
});
