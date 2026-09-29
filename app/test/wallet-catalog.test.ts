import { describe, expect, it } from 'vitest';

import { walletChoices } from '$lib/client/wallet/catalog';
import type { WalletOption } from '$lib/client/wallet/wallet.svelte';

const ORIGIN = 'https://accessory.test';
const TARGET = `${ORIGIN}/continue#h=abc`;
const opt = (name: string): WalletOption => ({ id: name.toLowerCase(), name, icon: '', ready: true });

describe('walletChoices', () => {
	it('lists detected wallets first, known ones in order, then deep links for the rest on phones', () => {
		const choices = walletChoices([opt('Glow'), opt('Solflare')], { browseTarget: TARGET, platform: 'ios', origin: ORIGIN });
		expect(choices.map((c) => `${c.kind}:${c.name}`)).toEqual([
			'detected:Solflare',
			'detected:Glow',
			'browse:Phantom',
			'browse:Backpack'
		]);
	});

	it('builds each wallet’s documented browse deep link with an encoded target and ref', () => {
		const hrefs = walletChoices([], { browseTarget: TARGET, platform: 'android', origin: ORIGIN }).map((c) => c.kind === 'browse' && c.href);
		const t = encodeURIComponent(TARGET);
		const r = encodeURIComponent(ORIGIN);
		expect(hrefs).toEqual([
			`https://phantom.app/ul/browse/${t}?ref=${r}`,
			`https://backpack.app/ul/v1/browse/${t}?ref=${r}`,
			`https://solflare.com/ul/v1/browse/${t}?ref=${r}`
		]);
	});

	it('offers no deep link for a wallet the connector already detected', () => {
		const choices = walletChoices([opt('Phantom')], { browseTarget: TARGET, platform: 'ios', origin: ORIGIN });
		expect(choices.filter((c) => c.name === 'Phantom')).toHaveLength(1);
		expect(choices[0].kind).toBe('detected');
	});

	it('offers no deep links on desktop, without a target, or for a foreign target', () => {
		expect(walletChoices([], { browseTarget: TARGET, platform: 'desktop', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: null, platform: 'ios', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: 'https://evil.example/continue', platform: 'ios', origin: ORIGIN })).toEqual([]);
		expect(walletChoices([], { browseTarget: `${ORIGIN}.evil.example/x`, platform: 'ios', origin: ORIGIN })).toEqual([]);
	});
});
